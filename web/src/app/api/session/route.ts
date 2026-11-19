// Saves one finished exercise from the patient's session page. Only numbers arrive here, never video:
// rep counts, quality scores, knee angles. The long random token in the patient's link identifies them.
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { celebrations, currentStreak, weeklyLine } from "@/lib/engagement";
import { processOutbox } from "@/lib/whatsapp/outbox";

type RepIn = { quality: number | null; fault: string | null; knee_bend_deg: number | null; rom_deg?: number | null; duration_s: number | null };
type Body = {
  token?: string;
  exercise_id?: string;
  source?: "camera" | "manual";
  started_at?: string;
  ended_at?: string;
  reps_target?: number;
  reps_done?: number;
  reps?: RepIn[];
};

const TIPS: Record<string, string> = {
  knees_in: "Tip for next time: keep your knees in line with your toes.",
  too_fast: "Tip for next time: go a little slower, especially on the way down.",
  not_upright: "Tip for next time: stand up all the way at the top.",
  sit_slowly: "Tip for next time: sit down slowly, with control.",
  not_straight: "Tip for next time: straighten your knee a little more, if it is comfortable.",
  no_hold: "Tip for next time: hold your leg straight for two seconds before lowering it.",
  lean_back: "Tip for next time: sit tall and keep your back still.",
  not_high: "Tip for next time: lift your arm to shoulder height, if it is comfortable.",
  bent_elbow: "Tip for next time: keep your arm straight as you lift it.",
  body_sway: "Tip for next time: keep your body still while your arm moves.",
  steady: "Tip for next time: slow and steady wins. Take about two seconds on the way down and two on the way up.",
};

// What the one stored number means, per exercise (knee-bend exercises use knee_bend_deg instead).
const ROM_LABEL: Record<string, string> = {
  seated_knee_extension: "straightest knee angle",
  arm_raise: "highest arm angle",
};

const bad = (message: string, status = 400) => Response.json({ error: message }, { status });
const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

const MAX_BODY_BYTES = 256 * 1024; // a session is at most 200 reps of a few numbers each

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return Response.json({ error: "too large" }, { status: 413 });
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return bad("invalid JSON");
  }
  if (!body.token || !/^[0-9a-f]{64}$/.test(body.token)) return bad("invalid link", 404);
  const source = body.source === "manual" ? "manual" : "camera";
  const reps = (Array.isArray(body.reps) ? body.reps : []).slice(0, 200).map((r, i) => ({
    idx: i + 1,
    quality: num(r?.quality, 0, 1),
    fault: typeof r?.fault === "string" && /^[a-z_]{1,30}$/.test(r.fault) ? r.fault : null,
    knee_bend_deg: num(r?.knee_bend_deg, 0, 180),
    rom_deg: num(r?.rom_deg, 0, 180),
    duration_s: num(r?.duration_s, 0, 60),
  }));
  const repsDone = source === "camera" ? reps.length : Math.round(num(body.reps_done, 0, 500) ?? 0);
  const now = Date.now();
  const started = Math.min(now, Date.parse(body.started_at ?? "") || now);
  const ended = Math.min(now, Math.max(started, Date.parse(body.ended_at ?? "") || now));

  const db = await getDb();
  const [patient] = await db.query<{ id: string; first_name: string }>(
    "select id, split_part(trim(display_name), ' ', 1) as first_name from patients where session_token = $1",
    [body.token],
  );
  if (!patient) return bad("invalid link", 404);
  const [item] = await db.query<{ prescription_id: string; name: string; sets: number; reps: number; tracking: string }>(
    `select r.id as prescription_id, e.name, pe.sets, pe.reps, e.tracking
       from prescriptions r join prescription_exercises pe on pe.prescription_id = r.id join exercises e on e.id = pe.exercise_id
      where r.patient_id = $1 and r.status = 'active' and pe.exercise_id = $2`,
    [patient.id, body.exercise_id ?? ""],
  );
  if (!item) return bad("this exercise is not in the current plan");
  if (source === "camera" && item.tracking !== "camera") return bad("this exercise is self-reported, not camera-scored");
  const [recent] = await db.query<{ n: number }>(
    "select count(*)::int as n from sessions where patient_id = $1 and exercise_id = $2 and ended_at > now() - interval '20 seconds'",
    [patient.id, body.exercise_id],
  );
  if (recent.n > 0) return bad("already saved", 409); // a double tap, or a retry of a request that did arrive

  const scored = reps.filter((r) => r.quality !== null);
  const qualityMean = scored.length ? scored.reduce((s, r) => s + (r.quality ?? 0), 0) / scored.length : null;
  const bends = reps.map((r) => r.knee_bend_deg).filter((v): v is number => v !== null);
  const bend = bends.length ? Math.max(...bends) : null;
  const roms = reps.map((r) => r.rom_deg).filter((v): v is number => v !== null);
  const rom = roms.length ? Math.max(...roms) : null;
  const faults: Record<string, number> = {};
  for (const r of reps) if (r.fault) faults[r.fault] = (faults[r.fault] ?? 0) + 1;

  const [previous] = await db.query<{ bend: number | null; rom: number | null }>(
    `select knee_bend_deg::float8 as bend, rom_deg::float8 as rom from sessions
      where patient_id = $1 and exercise_id = $2 and (knee_bend_deg is not null or rom_deg is not null)
      order by started_at desc limit 1`,
    [patient.id, body.exercise_id],
  );
  const [session] = await db.query<{ id: string }>(
    `insert into sessions (patient_id, prescription_id, exercise_id, started_at, ended_at, reps_target, reps_done,
                           quality_mean, knee_bend_deg, rom_deg, fault_counts, source)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12) returning id`,
    [patient.id, item.prescription_id, body.exercise_id, new Date(started), new Date(ended),
     item.sets * item.reps, repsDone, qualityMean === null ? null : qualityMean.toFixed(3),
     bend === null ? null : bend.toFixed(1), rom === null ? null : rom.toFixed(1), JSON.stringify(faults), source],
  );
  if (reps.length) {
    await db.query(
      `insert into reps (session_id, idx, quality, fault, knee_bend_deg, rom_deg, duration_s)
       select $1, x.idx, x.quality, x.fault, x.knee_bend_deg, x.rom_deg, x.duration_s
         from jsonb_to_recordset($2::jsonb)
           as x(idx int, quality numeric, fault text, knee_bend_deg numeric, rom_deg numeric, duration_s numeric)`,
      [session.id, JSON.stringify(reps)],
    );
  }

  // One WhatsApp message per camera session: what happened, compared with last time, one tip, and anything
  // worth celebrating (a streak, a personal best, a milestone; lib/engagement.ts).
  if (source === "camera" && repsDone > 0) {
    const topFault = Object.entries(faults).sort((a, b) => b[1] - a[1])[0]?.[0];
    const history = await db.query<{ id: string; started_at: Date; exercise_id: string; measure: number | null; quality: number | null }>(
      `select id, started_at, exercise_id, coalesce(knee_bend_deg, rom_deg)::float8 as measure, quality_mean::float8 as quality
         from sessions where patient_id = $1 order by started_at`,
      [patient.id],
    );
    const tzDay = (d: Date) => new Date(d).toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
    const today = tzDay(new Date());
    const days = [...new Set(history.map((h) => tzDay(h.started_at)))];
    const before = history.filter((h) => h.id !== session.id);
    const same = before.filter((h) => h.exercise_id === body.exercise_id);
    const measures = same.map((h) => h.measure).filter((v): v is number => v !== null);
    const qualities = same.map((h) => h.quality).filter((v): v is number => v !== null);
    const cheers = celebrations({
      firstName: patient.first_name,
      totalSessions: history.length,
      streak: currentStreak(days, today),
      streakBefore: currentStreak([...new Set(before.map((h) => tzDay(h.started_at)))], today),
      measureLabel: bend !== null ? "deepest knee bend" : ROM_LABEL[body.exercise_id ?? ""] ?? null,
      measure: bend ?? rom,
      previousBest: measures.length ? Math.max(...measures) : null,
      firstMeasure: measures.length ? measures[0] : null,
      quality: qualityMean,
      previousBestQuality: qualities.length ? Math.max(...qualities) : null,
    });
    // A weekly goal is kinder than a fragile daily streak: one missed day does not reset it.
    const [rx] = await db.query<{ days_per_week: number }>("select days_per_week from prescriptions where id = $1", [item.prescription_id]);
    const weekStart = tzDay(new Date(Date.now() - 6 * 86_400_000));
    const weekDays = days.filter((d) => d >= weekStart && d <= today).length;
    const weekDaysBefore = new Set(before.map((h) => tzDay(h.started_at)).filter((d) => d >= weekStart && d <= today)).size;
    const week = weeklyLine(weekDays, rx?.days_per_week ?? 0, weekDays > weekDaysBefore);
    const lines = [
      `Well done, ${patient.first_name}! ${item.name}: ${repsDone} reps` +
        (qualityMean !== null ? `, average quality ${Math.round(qualityMean * 100)}/100` : "") +
        (bend !== null ? `, deepest knee bend ${Math.round(bend)}°` : "") +
        (bend !== null && previous?.bend != null ? ` (last time ${Math.round(previous.bend)}°)` : "") +
        (rom !== null ? `, ${ROM_LABEL[body.exercise_id ?? ""] ?? "range of motion"} ${Math.round(rom)}°` : "") +
        (rom !== null && previous?.rom != null ? ` (last time ${Math.round(previous.rom)}°)` : "") + ".",
      ...cheers,
      ...(week ? [week] : []),
      topFault && TIPS[topFault] ? TIPS[topFault] : "Nice, steady form.",
      "Your physiotherapist can see this.",
    ];
    await db.query(
      "insert into messages (patient_id, direction, kind, body, payload, status) values ($1, 'out', 'text', $2, $3::jsonb, 'queued')",
      [patient.id, lines.join("\n"), JSON.stringify({ type: "session_summary", session_id: session.id })],
    );
    after(() => processOutbox(patient.id));
  }

  return Response.json({
    ok: true,
    session_id: session.id,
    reps: repsDone,
    quality: qualityMean === null ? null : Math.round(qualityMean * 100),
    knee_bend: bend === null ? null : Math.round(bend),
    previous_knee_bend: previous?.bend == null ? null : Math.round(previous.bend),
    rom: rom === null ? null : Math.round(rom),
    previous_rom: previous?.rom == null ? null : Math.round(previous.rom),
  });
}
