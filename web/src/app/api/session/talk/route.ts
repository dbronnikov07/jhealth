// The spoken coach (lib/coach/voice-coach.ts): what the patient said, or the moment (start, set done, finished),
// in; a short answer, as text and as speech, out. Pain and red flags never reach the AI: the fixed rules answer.
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { assessMessage } from "@/lib/safety";
import { raiseSafetyAlert } from "@/lib/safety-actions";
import { forSpeech, speech, splitSentences, ttsTicket, voiceReply, type VoiceContext, type VoiceEvent } from "@/lib/coach/voice-coach";
import { processOutbox } from "@/lib/whatsapp/outbox";

const MAX_BODY_BYTES = 8 * 1024;
const EVENTS: VoiceEvent[] = ["heard", "start", "set_done", "finished", "prepare"];
const TURNS_PER_10_MIN = 40;

const num = (x: unknown, lo: number, hi: number): number | null =>
  typeof x === "number" && Number.isFinite(x) ? Math.round(Math.min(hi, Math.max(lo, x))) : null;
const text = (x: unknown, max: number): string | null =>
  typeof x === "string" && x.trim() ? x.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : null;

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return Response.json({ error: "too large" }, { status: 413 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token : "";
  if (!/^[0-9a-f]{64}$/.test(token)) return Response.json({ error: "invalid link" }, { status: 404 });
  const event = EVENTS.find((e) => e === body.event);
  if (!event) return Response.json({ error: "invalid event" }, { status: 400 });
  const heard = event === "heard" ? text(body.heard, 300) : null;
  if (event === "heard" && !heard) return Response.json({ error: "nothing heard" }, { status: 400 });

  const db = await getDb();
  const [patient] = await db.query<{ id: string; first_name: string; condition: string | null; side: string | null }>(
    "select id, split_part(trim(display_name), ' ', 1) as first_name, condition, side from patients where session_token = $1",
    [token],
  );
  if (!patient) return Response.json({ error: "invalid link" }, { status: 404 });
  const [recent] = await db.query<{ n: number }>(
    "select count(*)::int as n from voice_turns where patient_id = $1 and created_at > now() - interval '10 minutes'",
    [patient.id],
  );
  if ((recent?.n ?? 0) >= TURNS_PER_10_MIN) return Response.json({ error: "too many" }, { status: 429 });

  // What makes it personal: what the coach has learned in the chat, and how the last session went.
  const [memories, [last]] = await Promise.all([
    db.query<{ kind: string; fact: string }>(
      "select kind, fact from memories where patient_id = $1 and superseded_by is null order by created_at desc limit 6",
      [patient.id],
    ),
    db.query<{ days: number; name: string; reps_done: number; bend: number | null; rom: number | null }>(
      `select (current_date - s.started_at::date)::int as days, e.name, s.reps_done,
              s.knee_bend_deg::float8 as bend, s.rom_deg::float8 as rom
         from sessions s join exercises e on e.id = s.exercise_id
        where s.patient_id = $1 order by s.started_at desc limit 1`,
      [patient.id],
    ),
  ]);
  const c = (body.context ?? {}) as Record<string, unknown>;
  const exerciseId = typeof c.exercise_id === "string" && /^[a-z0-9_]{1,60}$/.test(c.exercise_id) ? c.exercise_id : null;
  const [exercise] = exerciseId ? await db.query<{ name: string }>("select name from exercises where id = $1", [exerciseId]) : [];
  const ctx: VoiceContext = {
    firstName: patient.first_name,
    exercise: exercise?.name ?? "the exercise",
    repsDone: num(c.reps_done, 0, 500) ?? 0,
    target: num(c.target, 1, 500) ?? 10,
    set: num(c.set, 1, 20) ?? 1,
    sets: num(c.sets, 1, 20) ?? 1,
    lastCue: text(c.last_cue, 120),
    quality: num(c.quality, 0, 100),
    bestDegrees: num(c.best_degrees, 0, 180),
    previousDegrees: num(c.previous_degrees, 0, 180),
    notCounted: num(c.not_counted, 0, 500) ?? 0,
    condition: patient.condition && patient.condition !== "Not assessed yet" ? `${patient.condition}${patient.side ? `, ${patient.side} side` : ""}` : null,
    memories: memories.map((m) => `${m.kind}: ${m.fact}`.slice(0, 160)),
    lastSession: last
      ? `${last.days === 0 ? "earlier today" : last.days === 1 ? "yesterday" : `${last.days} days ago`}: ${last.name}, ${last.reps_done} reps` +
        (last.bend !== null ? `, knee bend ${Math.round(last.bend)} degrees` : last.rom !== null ? `, range ${Math.round(last.rom)} degrees` : "")
      : null,
  };

  let reply: string;
  let action: "none" | "stop" = "none";
  const safety = heard ? assessMessage(heard) : null;
  if (safety) {
    // The same rule as a pain message in the chat: alert, remember, and a fixed answer. Never the AI.
    await raiseSafetyAlert({ patientId: patient.id, level: safety.level, reason: `${safety.reason} (said out loud during ${ctx.exercise})`, reply: safety.reply });
    after(() => processOutbox(patient.id));
    reply = forSpeech(`Thank you for telling me, ${ctx.firstName}. Please stop and rest now. I've told your physiotherapist.`);
    action = "stop";
  } else {
    reply = event === "prepare" ? (await voiceReply(event, heard, ctx, { keepLines: true })).text : (await voiceReply(event, heard, ctx)).text;
  }

  const audio = event === "prepare" ? null : await speech(reply);
  await db.query(
    "insert into voice_turns (patient_id, event, exercise_id, heard, reply) values ($1, $2, $3, $4, $5)",
    [patient.id, event, exerciseId, heard, reply.slice(0, 600)],
  );
  // Speech: OpenAI's voice if a key is set; otherwise a signed ticket for our own voice (api/tts.py).
  if (event === "prepare") {
    // Five personal lines for during the set, each its own speech ticket; the browser makes them in the background.
    const lines = reply.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map((l) => forSpeech(l.replace(/^[\s\d.)\-*"]+|"$/g, ""))).filter((l) => l.length >= 4).slice(0, 5);
    return Response.json({ reply: lines.join(" "), action, audio: null, lines: lines.map((l) => ({ text: l, tts: ttsTicket(l) })) });
  }
  const tickets = audio ? [] : splitSentences(reply).map(ttsTicket).filter((t) => t !== null);
  return Response.json({ reply, action, audio: audio ? audio.toString("base64") : null, tts: tickets.length ? tickets : null });
}
