// Sends today's reminders, comeback nudges and Sunday progress cards (wording: lib/engagement.ts).
// Called by /api/cron/reminders (every hour on Vercel; `npm run reminders` on this laptop).
//
// Rules:
//   - real patients only (simulated ones never get messages), with an active plan and reminders switched on;
//   - at most one engagement message per patient per day, at or after their reminder hour (Toronto time);
//   - nobody who already exercised today, and nobody with an open pain or red-flag alert (exercise is on hold);
//   - WhatsApp only allows free-form messages within 24 hours of the patient's last message. Outside that window
//     a business may only send pre-approved templates (and Meta charges for them), so those patients are skipped
//     and counted; the dashboard shows the plan is waiting.
import { getDb } from "./db";
import { currentStreak, reminderKind, reminderText, type ReminderKind } from "./engagement";
import { WHY_BUTTONS } from "./quick-replies";
import { processOutbox } from "./whatsapp/outbox";

const TZ = "America/Toronto";
const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });          // YYYY-MM-DD
const hourOf = (d: Date) => Number(d.toLocaleString("en-CA", { timeZone: TZ, hour: "2-digit", hour12: false })) % 24;
const weekdayOf = (d: Date) => new Date(`${dayOf(d)}T12:00:00Z`).getUTCDay();
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

export type ReminderRun = { queued: { patient: string; kind: ReminderKind }[]; skipped: Record<string, number> };

export async function runReminders(opts: { now?: Date; force?: boolean; patientId?: string; send?: boolean } = {}): Promise<ReminderRun> {
  const now = opts.now ?? new Date();
  const today = dayOf(now);
  const db = await getDb();
  const result: ReminderRun = { queued: [], skipped: {} };
  const skip = (why: string) => (result.skipped[why] = (result.skipped[why] ?? 0) + 1);

  const patients = await db.query<{ id: string; first_name: string; reminder_hour: number; prescription_id: string; days_per_week: number }>(
    `select p.id, split_part(trim(p.display_name), ' ', 1) as first_name, p.reminder_hour, r.id as prescription_id, r.days_per_week
       from patients p join prescriptions r on r.patient_id = p.id and r.status = 'active'
      where not p.is_simulated and p.reminders_enabled and ($1::uuid is null or p.id = $1::uuid)`,
    [opts.patientId ?? null],
  );

  for (const p of patients) {
    if (!opts.force && hourOf(now) < p.reminder_hour) { skip("before their reminder hour"); continue; }

    const [sentToday] = await db.query<{ n: number }>(
      `select count(*)::int as n from messages
        where patient_id = $1 and direction = 'out' and payload->>'type' in ('reminder', 'comeback', 'weekly')
          and created_at > $2::timestamptz - interval '20 hours'`,
      [p.id, now.toISOString()],
    );
    if (sentToday.n > 0 && !opts.force) { skip("already reminded today"); continue; }

    const [onHold] = await db.query<{ n: number }>(
      "select count(*)::int as n from alerts where patient_id = $1 and resolved_at is null and kind in ('pain', 'red_flag')",
      [p.id],
    );
    if (onHold.n > 0) { skip("exercise on hold (open pain alert)"); continue; }

    const [lastIn] = await db.query<{ at: Date | null }>(
      "select max(created_at) as at from messages where patient_id = $1 and direction = 'in'",
      [p.id],
    );
    if (!lastIn?.at || now.getTime() - new Date(lastIn.at).getTime() > 23.5 * 3600_000) {
      skip("outside WhatsApp's 24-hour window (needs an approved template)");
      continue;
    }

    const sessions = await db.query<{ started_at: Date; knee: number | null; rom: number | null }>(
      "select started_at, knee_bend_deg::float8 as knee, rom_deg::float8 as rom from sessions where patient_id = $1 order by started_at desc limit 400",
      [p.id],
    );
    const days = [...new Set(sessions.map((s) => dayOf(new Date(s.started_at))))];
    const sessionToday = days.includes(today);
    const last = days[0] ?? null;
    const kind = reminderKind({ daysSinceLastSession: last ? daysBetween(last, today) : null, sessionToday, weekday: weekdayOf(now) });
    if (!kind) { skip("already exercised today"); continue; }

    const exercises = await db.query<{ name: string; tracking: string }>(
      `select e.name, e.tracking from prescription_exercises pe join exercises e on e.id = pe.exercise_id
        where pe.prescription_id = $1 order by pe.position`,
      [p.prescription_id],
    );
    const [goal] = await db.query<{ fact: string }>(
      "select fact from memories where patient_id = $1 and kind = 'goal' and superseded_by is null order by created_at desc limit 1",
      [p.id],
    );
    const weekAgo = dayOf(new Date(now.getTime() - 6 * 86_400_000));
    const weekDays = days.filter((d) => d >= weekAgo && d <= today).length;
    const text = reminderText(kind, {
      firstName: p.first_name, goal: goal?.fact ?? null, exercises: exercises.map((e) => e.name),
      streak: currentStreak(days.filter((d) => d < today), today), daysSinceLastSession: last ? daysBetween(last, today) : null,
      dayNumber: Math.floor(Date.parse(`${today}T12:00:00Z`) / 86_400_000),
    }, { sessions: weekDays, planned: p.days_per_week, best: null });

    const hasCamera = exercises.some((e) => e.tracking === "camera");
    // A comeback asks what got in the way (tappable answers); a reminder carries the Start button.
    const payload = kind === "comeback" ? { type: kind, quick_replies: WHY_BUTTONS }
      : { type: kind, start_button: hasCamera && kind === "reminder" };
    await db.query(
      "insert into messages (patient_id, direction, kind, body, payload, status) values ($1, 'out', $2, $3, $4::jsonb, 'queued')",
      [p.id, kind === "weekly" || (kind === "reminder" && !hasCamera) ? "text" : "buttons", text, JSON.stringify(payload)],
    );
    result.queued.push({ patient: p.id, kind });
    if (opts.send !== false) await processOutbox(p.id);
  }
  return result;
}
