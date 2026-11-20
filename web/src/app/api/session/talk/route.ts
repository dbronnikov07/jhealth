// The spoken coach (lib/coach/voice-coach.ts): what the patient said, or the moment (start, set done, finished),
// in; a short answer, as text and as speech, out. Pain and red flags never reach the AI: the fixed rules answer.
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { assessMessage } from "@/lib/safety";
import { raiseSafetyAlert } from "@/lib/safety-actions";
import { forSpeech, speech, ttsTicket, voiceReply, type VoiceContext, type VoiceEvent } from "@/lib/coach/voice-coach";
import { processOutbox } from "@/lib/whatsapp/outbox";

const MAX_BODY_BYTES = 8 * 1024;
const EVENTS: VoiceEvent[] = ["heard", "start", "set_done", "finished"];
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
  const [patient] = await db.query<{ id: string; first_name: string }>(
    "select id, split_part(trim(display_name), ' ', 1) as first_name from patients where session_token = $1",
    [token],
  );
  if (!patient) return Response.json({ error: "invalid link" }, { status: 404 });
  const [recent] = await db.query<{ n: number }>(
    "select count(*)::int as n from voice_turns where patient_id = $1 and created_at > now() - interval '10 minutes'",
    [patient.id],
  );
  if ((recent?.n ?? 0) >= TURNS_PER_10_MIN) return Response.json({ error: "too many" }, { status: 429 });

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
    reply = (await voiceReply(event, heard, ctx)).text;
  }

  const audio = await speech(reply);
  await db.query(
    "insert into voice_turns (patient_id, event, exercise_id, heard, reply) values ($1, $2, $3, $4, $5)",
    [patient.id, event, exerciseId, heard, reply.slice(0, 600)],
  );
  // Speech: OpenAI's voice if a key is set; otherwise a signed ticket for our own voice (api/tts.py).
  return Response.json({ reply, action, audio: audio ? audio.toString("base64") : null, tts: audio ? null : ttsTicket(reply) });
}
