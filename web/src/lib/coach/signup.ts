// Sign-up in conversation: someone who found Motiva on their own typed or spoke ("I had a knee replacement, saw you
// on Instagram, tell me about yourself") instead of tapping a button. What they said has already been read by code
// (lib/quick-replies.ts signupDetails: condition and side); here the AI answers them like a person who listened,
// then the next sign-up question goes out under its answer with the buttons, or the starter plan if nothing is left.
// Without the AI (no key, or it fails) they still get the question, so sign-up never stalls.
import { getDb, type Db } from "../db";
import { CONDITION_BUTTONS, setupQuestion, SIDE_BUTTONS, signupQuestion } from "../quick-replies";
import { sendStarterPlan } from "../whatsapp/inbound";
import { adaptionConfig, AdaptionError, chatJson } from "./adaption";
import { buildSignupMessages, parseCoachOutput, REPLY_SCHEMA, type CoachContext } from "./prompt";

const TZ = "America/Toronto";
const when = (d: Date | string) => new Date(d).toLocaleString("en-CA", {
  timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
});

export type SignupRun = { status: "skipped" } | { status: "replied" | "fallback"; step: "condition" | "side" | "done"; error?: string };

export async function signupReply(patientId: string, messageId: string, db?: Db): Promise<SignupRun> {
  db ??= await getDb();
  const [latest] = await db.query<{ id: string; body: string | null }>(
    "select id, body from messages where patient_id = $1 and direction = 'in' order by created_at desc limit 1",
    [patientId],
  );
  if (!latest || latest.id !== messageId) return { status: "skipped" }; // a newer message gets its own answer

  const [p] = await db.query<{ first_name: string | null; condition: string; side: string | null; earlier: number }>(
    `select nullif(split_part(trim(display_name), ' ', 1), 'WhatsApp') as first_name, condition, side,
            (select count(*)::int from messages m where m.patient_id = patients.id and m.id <> $2) as earlier
       from patients where id = $1`,
    [patientId, messageId],
  );
  if (!p) return { status: "skipped" };
  const step = p.condition === "Not assessed yet" ? "condition" : /knee|hip/i.test(p.condition) && !p.side ? "side" : "done";

  const chat = await db.query<{ direction: "in" | "out"; body: string | null; at: Date }>(
    `select direction, body, coalesce(sent_at, created_at) as at from messages
      where patient_id = $1 and status not in ('failed', 'cancelled') and id <> $2 and body is not null
      order by coalesce(sent_at, created_at) desc limit 10`,
    [patientId, messageId],
  );

  let reply: string | null = null;
  let error = "";
  let meta: Record<string, unknown> = {};
  const cfg = adaptionConfig();
  if (cfg) {
    try {
      const result = await chatJson(cfg, buildSignupMessages({
        now: `${when(new Date())} (Toronto time)`,
        firstName: p.first_name, firstContact: p.earlier === 0, step, condition: p.condition, side: p.side,
        chat: chat.reverse().map((m) => ({ who: m.direction === "in" ? "patient" : "coach", when: when(m.at), text: m.body ?? "" })),
        latest: latest.body ?? "",
      }), REPLY_SCHEMA, { timeoutMs: 20_000 });
      // The same checks as every coach answer: no links, no medicine, length. No plan yet, so never a Start button.
      const none: CoachContext = {
        now: "", patient: { firstName: p.first_name ?? "", condition: p.condition, side: p.side, language: "en" },
        plan: null, sessions: [], doctorNotes: [], memories: [], openAlerts: [], exerciseOnHold: false, chat: [], latest: "",
      };
      const out = parseCoachOutput(result.content, none);
      if (out) {
        reply = out.reply;
        meta = { model: result.model, ms: result.ms, usage: result.usage };
        for (const m of out.memories) {
          await db.query(
            "insert into memories (patient_id, kind, fact, source_message_id, author) values ($1, $2, $3, $4, 'coach')",
            [patientId, m.kind, m.fact, messageId],
          );
        }
        if (out.flagForPhysio) {
          await db.query("insert into alerts (patient_id, kind, detail, source_message_id) values ($1, 'coach', $2, $3)",
            [patientId, `Coach: ${out.flagForPhysio}`, messageId]);
        }
      } else error = "The model's answer could not be read";
    } catch (e) {
      error = e instanceof AdaptionError ? e.message : String(e);
    }
  } else error = "not configured";
  if (error) console.warn(`[signup] no AI answer for patient ${patientId}: ${error}`);

  const payload = (type: string, extra: object) => JSON.stringify({ type, in_reply_to: messageId, ...meta, ...(error ? { error } : {}), ...extra });
  if (step === "done") {
    if (reply) {
      await db.query(
        "insert into messages (patient_id, direction, kind, body, payload, status) values ($1, 'out', 'text', $2, $3::jsonb, 'queued')",
        [patientId, reply, payload("signup_answer", {})],
      );
    }
    await sendStarterPlan(db, patientId);
    return { status: reply ? "replied" : "fallback", step };
  }
  const question = signupQuestion(step, p.condition);
  const body = reply ? `${reply}\n\n${question}`
    : step === "condition" && p.earlier === 0 ? setupQuestion(p.first_name) : `Thanks for your message! ${question}`;
  await db.query(
    "insert into messages (patient_id, direction, kind, body, payload, status) values ($1, 'out', 'buttons', $2, $3::jsonb, 'queued')",
    [patientId, body, payload(step === "condition" ? "welcome" : "signup_side", { quick_replies: step === "condition" ? CONDITION_BUTTONS : SIDE_BUTTONS })],
  );
  return { status: reply ? "replied" : "fallback", step };
}
