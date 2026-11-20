// The spoken coach during a camera session: it hears the patient (the browser turns speech into text), answers in
// one or two short sentences, and its answer is spoken in a natural voice (OpenAI text-to-speech).
//
// What it may do, and what it never does, is the same as the chat coach: it encourages, explains the exercise and
// answers questions; it never diagnoses, never changes the plan, never gives medical advice. Pain and red flags are
// handled by fixed rules before the AI sees anything (lib/safety.ts), and falls by the camera (lib/pose/fall.ts).
import { createHmac } from "node:crypto";
import { adaptionConfig, chatText } from "./adaption.ts";

export type VoiceEvent = "heard" | "start" | "set_done" | "finished";

export type VoiceContext = {
  firstName: string;
  exercise: string;
  repsDone: number;
  target: number;
  set: number;
  sets: number;
  lastCue: string | null;       // the last thing the rules said about form, if any
  quality: number | null;       // average quality 0 to 100 so far
  bestDegrees: number | null;   // deepest knee bend (or highest arm) this session
  previousDegrees: number | null;
  notCounted: number;           // movements too small to count
};

export const VOICE_SYSTEM_PROMPT = `You are the Motiva Health voice coach. You speak out loud, in real time, to a patient doing a home exercise in front of their phone or tablet camera. They are usually an older adult recovering from knee or hip surgery, standing about two metres away.

How you talk:
- Usually one short sentence, at most two, and never more than 25 words. This is speech, not text: short answers come back faster.
- Warm, upbeat and natural, like a good physiotherapist in the room. Use their first name now and then, not every time.
- Use the real numbers you are given (repetitions, degrees, quality). Never invent numbers.
- Plain words. No lists, no emoji, no dashes, no semicolons, no stage directions.
- If they ask how to do the exercise, explain one thing at a time, simply.
- If they ask something unrelated, answer in a few words and bring them back to the exercise.

What you never do:
- Never diagnose, never change their plan or the number of repetitions, never suggest medicine.
- Mild stiffness or tiredness is normal in rehab: reassure them and suggest a smaller, slower movement.
- If they mention pain, dizziness, chest pain or feeling unwell, tell them to stop and rest, and say their physiotherapist will be told. Do not ask about it in detail.
- Never claim you can see things you were not told about.

The moment you are answering:
- "start": they just got in front of the camera. Greet them briefly and ask how they feel today.
- "set_done": a set is finished. Praise one real thing, mention the numbers, and ask how that felt.
- "finished": the session is over. Give a short spoken summary with the numbers and one encouragement for next time.
- "heard": they just said something. Answer it.`;

/**
 * The answer in sentences, so the first one can be spoken while the next is still being made (our voice server
 * needs about 1.5 s per second of speech). Very short pieces join the next one; at most 3 parts.
 */
export function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (out.length && (out[out.length - 1].length < 14 || out.length >= 3)) out[out.length - 1] += ` ${p}`;
    else out.push(p);
  }
  return out;
}

/** Removes what sounds wrong when spoken, and keeps it short. */
export function forSpeech(text: string): string {
  return text
    .replace(/[—–]/g, ",").replace(/;/g, ",").replace(/[*_#>`]/g, "")
    .replace(/\s+/g, " ").trim().slice(0, 400);
}

export function buildVoiceMessages(event: VoiceEvent, heard: string | null, c: VoiceContext) {
  const facts = [
    `Patient: ${c.firstName}. Exercise: ${c.exercise}.`,
    `Repetitions counted so far today: ${c.repsDone} of ${c.target} in all, over ${c.sets} ${c.sets === 1 ? "set" : "sets"}.`,
    c.notCounted ? `Movements too small to count: ${c.notCounted}.` : null,
    c.quality !== null ? `Average quality so far: ${c.quality} out of 100.` : null,
    c.bestDegrees !== null ? `Best range this session: ${c.bestDegrees} degrees${c.previousDegrees !== null ? `, last time ${c.previousDegrees} degrees` : ""}.` : null,
    c.lastCue ? `Last form tip given: "${c.lastCue}".` : null,
  ].filter(Boolean).join("\n");
  const moment =
    event === "heard" ? `Moment: heard. They are in set ${c.set} of ${c.sets}. They said: "${(heard ?? "").slice(0, 300)}"`
      : event === "set_done" ? `Moment: set_done. They just finished set ${c.set} of ${c.sets}.`
        : `Moment: ${event}.`;
  return [
    { role: "system" as const, content: VOICE_SYSTEM_PROMPT },
    { role: "user" as const, content: `${facts}\n${moment}\nYour spoken answer:` },
  ];
}

/** When the AI is not available: still say something true and useful. */
export function fallbackLine(event: VoiceEvent, c: VoiceContext): string {
  if (event === "finished") return `Nice work, ${c.firstName}. That's ${c.repsDone} repetitions done today.`;
  if (event === "set_done") return `That's set ${c.set} done. Take a breather, then carry on.`;
  if (event === "start") return `Hi ${c.firstName}. Let's get started.`;
  return "Sorry, I didn't catch that. Let's keep going.";
}

export const VOICE_MODEL = () => process.env.ADAPTION_VOICE_MODEL || "gemma-4-31b-it";

/**
 * A spoken conversation needs a fast answer. Adaption's gemma-4-31b-it answered in 0.3 to 0.5 s in our test on
 * 20 November (deepseek-v4-flash took about 3 s because it reasons first; glm-5.3-flash and qwen3.8-27b spent the
 * whole budget thinking and returned nothing). With an OpenAI key, OpenAI's small chat model is tried first.
 */
async function openaiChat(messages: { role: "system" | "user"; content: string }[]): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini", messages, max_tokens: 120, temperature: 0.6 }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
    return body.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

export async function voiceReply(event: VoiceEvent, heard: string | null, c: VoiceContext): Promise<{ text: string; fromAi: boolean }> {
  const messages = buildVoiceMessages(event, heard, c);
  const fromOpenai = forSpeech((await openaiChat(messages)) ?? "");
  if (fromOpenai.length >= 2) return { text: fromOpenai, fromAi: true };
  const cfg = adaptionConfig();
  if (!cfg) return { text: fallbackLine(event, c), fromAi: false };
  try {
    // Room for a model that thinks first (deepseek-v4-flash spends 150 to 300 tokens on it) if one is configured.
    const r = await chatText(cfg, messages, { model: VOICE_MODEL(), maxTokens: 1200, timeoutMs: 9000 });
    const text = forSpeech(r.content ?? "");
    return text.length >= 2 ? { text, fromAi: true } : { text: fallbackLine(event, c), fromAi: false };
  } catch {
    return { text: fallbackLine(event, c), fromAi: false };
  }
}

/**
 * A ticket for our own voice (api/tts.py, Kokoro "heart" on Vercel): the text, an expiry a minute away, and an
 * HMAC with TTS_SECRET, so that endpoint speaks only what this coach wrote. Null without TTS_SECRET.
 */
export function ttsTicket(text: string): { text: string; exp: number; sig: string } | null {
  const secret = process.env.TTS_SECRET;
  if (!secret || !text) return null;
  const exp = Math.floor(Date.now() / 1000) + 60;
  const sig = createHmac("sha256", secret).update(`${exp}.${text}`).digest("hex");
  return { text, exp, sig };
}

/**
 * The answer as speech: OpenAI text-to-speech, mp3, or null when no key is set (our own voice or the browser's is used).
 *   OPENAI_API_KEY    required for the natural voice
 *   OPENAI_TTS_VOICE  optional, default "coral" (warm)
 */
export async function speech(text: string): Promise<Buffer | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !text) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
        voice: process.env.OPENAI_TTS_VOICE || "coral",
        input: text,
        instructions: "Speak like a warm, upbeat physiotherapist coaching someone in the same room. Natural pace, friendly, clear, never robotic.",
        response_format: "mp3",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}
