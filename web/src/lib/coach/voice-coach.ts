// The spoken coach during a camera session: it hears the patient (the browser turns speech into text), answers in
// one or two short sentences, and its answer is spoken in a natural voice (OpenAI text-to-speech).
//
// What it may do, and what it never does, is the same as the chat coach: it encourages, explains the exercise and
// answers questions; it never diagnoses, never changes the plan, never gives medical advice. Pain and red flags are
// handled by fixed rules before the AI sees anything (lib/safety.ts), and falls by the camera (lib/pose/fall.ts).
import { createHmac } from "node:crypto";
import { adaptionConfig, chatText } from "./adaption.ts";

export type VoiceEvent = "heard" | "start" | "set_done" | "finished" | "prepare";

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
  notCounted: number;           // movements that did not count (too small, or pushed with the hands)
  form?: string | null;         // what the camera saw so far, in words: good reps, each mistake and how often
  formData?: FormData | null;   // the same as numbers, for answering "am I doing it right?" without the AI
  condition: string | null;     // e.g. "Total knee replacement, right side"
  memories: string[];           // what the coach knows: goals, preferences, pain reported, from the chat
  lastSession: string | null;   // e.g. "2 days ago: chair squat, 20 reps, knee bend 66 degrees"
  liveFacts?: string[];         // the time now, and the weather when they ask about it (liveFacts below)
};

/** What the camera has judged so far in this session. The tips are the app's own cue texts. */
export type FormData = {
  counted: number;              // repetitions that counted
  good: number;                 // of those, with no mistake
  topFault: string | null;      // the mistake seen most, as its cue ("Knees out, over your toes")
  topFaultCount: number;
  lastFault: string | null;     // the last counted repetition's mistake, if any
  lastScore: number | null;     // its score, 0 to 100
  hands: number;                // movements not counted because the hands pushed
  small: number;                // movements not counted because they were too small
};

const FORM_QUESTION = new RegExp([
  "\\b(am i|are we|i am|i'm) doing (it|this|that|them|these|everything)? ?(all )?(right|correct|correctly|ok|okay|well|good|properly|fine|wrong)\\b",
  "\\bhow am i doing\\b", "\\bhow('s| is| was| are) (my|the) (form|technique|squats?|posture|reps?|repetitions?)\\b",
  "\\b(is|was|does) (this|that|it|my form) (look )?(right|correct|ok|okay|good|fine)\\b",
  "\\bwhat (should|can|do) i (fix|improve|change|do better)\\b", "\\bany (mistakes?|corrections?|tips)\\b",
  "\\bdoing (it|this) (right|correct|correctly)\\b", "\\bdo(es)? (it|i|that) look (right|good|ok|okay)\\b",
].join("|"), "i");

const lower = (cue: string) => cue.charAt(0).toLowerCase() + cue.slice(1);

/**
 * "Am I doing it right?" answered from what the camera measured, in code: instantly, with the real numbers, and with
 * the tip in the app's own words. (The AI reworded "Knees out, over your toes" into "keep your knees behind your
 * toes", which is different advice.) Returns null when the sentence is not a question about form.
 */
export function formAnswer(heard: string | null, firstName: string, f: FormData | null | undefined): string | null {
  if (!heard || !f || !FORM_QUESTION.test(heard)) return null;
  const notCounted = f.hands + f.small;
  if (f.counted === 0 && notCounted === 0) return `I'm watching, ${firstName}. Do one repetition and I'll tell you how it looks.`;
  if (f.hands > 0 && f.hands >= f.topFaultCount && f.hands >= f.small) {
    return `${f.hands === 1 ? "One" : f.hands} didn't count because your hands pushed. Cross your arms on your chest, and stand up with your legs.`;
  }
  if (f.counted === 0) return `Not yet, ${firstName}. Those were too small to count. Go a little further, as far as is comfortable.`;
  const clean = `${f.good} of ${f.counted}`;
  if (!f.topFault) {
    return `Yes, ${firstName}, it looks good. ${f.counted === 1 ? "That one was clean" : `${clean} were clean`}${f.lastScore !== null ? `, and the last one scored ${f.lastScore} out of 100` : ""}.`;
  }
  const lastFine = f.lastFault === null ? " Your last one was good." : "";
  return `${clean} were clean, ${firstName}. The thing to fix: ${lower(f.topFault)}.${lastFine}`;
}

export const VOICE_SYSTEM_PROMPT = `You are the Motiva Health voice coach. You speak out loud, in real time, to a patient doing a home exercise in front of their phone or tablet camera. They are usually an older adult recovering from knee or hip surgery, standing about two metres away.

How you talk:
- One short sentence, at most 15 words, unless they ask you to explain something (then at most 30). This is speech: short answers come back faster.
- Answer what they actually said, like a person would. If they ask how you are, answer briefly and warmly and turn it back to them.
- Make it personal: their name now and then, their surgery, their goal, how today compares with last time. Never the same praise twice.
- Warm, upbeat and natural, like a good physiotherapist in the room. Use their first name now and then, not every time.
- Use the real numbers you are given (repetitions, degrees, quality). Never invent numbers.
- Plain words. No lists, no emoji, no dashes, no semicolons, no stage directions.
- If they ask how to do the exercise, explain one thing at a time, simply.
- If they ask whether they are doing it right, how their form is, or what to fix: you DO see them, through "Form so
  far". Say what the camera saw: that it looks good with one real number, or the mistake seen most and its fix in a
  few words. Give the fix in the camera's own words (for example "Knees out, over your toes"): never reword a tip
  into different advice. If some movements did not count, say why. If nothing is counted yet, say you are watching
  and ask them to do one repetition.
- No filler. Never say you did not understand unless the words make no sense at all; if a word seems misheard, answer
  the most likely meaning.
- Do not end your answer with a question. Only the greeting at the start and the check-in after a set ask one. Never
  ask "Ready?" or "Shall we?": they are already exercising. A statement is enough.
- What you hear comes through a microphone two metres away, so a sentence may arrive with a wrong word in it or cut
  in two. Answer what they most likely meant, in the context of the exercise; never comment on a strange word.
- Talk like a friendly, well-informed person. Answer any question properly and briefly: small talk, general
  knowledge, the time, the weather. For the weather and the time use the live facts you are given, with the real
  numbers; never invent weather or news, and if you do not know something, say so in a few words. After a non-exercise
  answer you may add a very short nudge back to the exercise, not always.

What you never do:
- Never diagnose, never change their plan or the number of repetitions, never suggest medicine.
- Mild stiffness or tiredness is normal in rehab: reassure them and suggest a smaller, slower movement.
- If they mention pain, dizziness, chest pain or feeling unwell, tell them to stop and rest, and say their physiotherapist will be told. Do not ask about it in detail.
- Never claim you can see things you were not told about.

The moment you are answering:
- "start": they just got in front of the camera. Greet them briefly and ask how they feel today.
- "set_done": a set is finished. Praise one real thing, mention the numbers, and ask how that felt.
- "finished": the session is over. Give a short spoken summary with the numbers and one encouragement for next time.
- "heard": they just said something. Answer it.
- "prepare": write 5 different encouragement lines to say during the set, at most 10 words each, one per line, no numbering or quotes. Make them personal: use their name in two, their goal or their progress if you know it.`;

/**
 * The answer in sentences, so the first one can be spoken while the next is still being made (our voice server
 * needs about 1.5 s per second of speech). Very short pieces join the next one; at most 3 parts.
 */
export function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  // The first piece is kept short (about five words), so the first sound comes sooner: on our server the voice takes
  // about as long to make as to play. A long first sentence is cut where a speaker would breathe anyway.
  const first = parts[0] ?? "";
  const words = first.split(" ");
  if (words.length > 6) {
    // Best: after an early comma. Next best: before a small linking word. Otherwise after five words.
    const comma = words.findIndex((w, i) => i >= 2 && i <= 6 && w.endsWith(",") && words.length - i - 1 >= 2);
    const link = words.findIndex((w, i) => i >= 3 && i <= 7 && /^(and|but|so|for|to|with|then|while|until|because|if)$/i.test(w));
    const cut = comma >= 0 ? comma + 1 : link >= 0 ? link : 5;
    if (words.length - cut >= 3) parts.splice(0, 1, words.slice(0, cut).join(" "), words.slice(cut).join(" "));
  }
  // Later pieces: very short ones join the one before, and there are at most three pieces.
  const out: string[] = [];
  for (const p of parts) {
    if (out.length > 1 && (out[out.length - 1].length < 14 || out.length >= 3)) out[out.length - 1] += ` ${p}`;
    else out.push(p);
  }
  return out;
}

/**
 * A first name as the voice should say it. Names transliterated from Russian or Ukrainian often end in "ii" or "iy"
 * (Dmitrii, Yurii, Andriy); the voice read "Dmitrii" as "Dmitri-eye", and the patient corrected it out loud three
 * times (live log, 20 November). One "i" is said right.
 */
export function spokenName(name: string): string {
  return name.replace(/(ii|iy|yi)$/i, "i");
}

/** The text with the patient's name respelled for the voice (the screen keeps the real spelling). */
export function forVoice(text: string, firstName: string): string {
  const said = spokenName(firstName);
  return said === firstName || !firstName ? text : text.split(firstName).join(said);
}

/**
 * The answer without the patient's name. The AI put the name into almost every answer ("Yes, I can hear you,
 * Dmitrii." eleven times in two minutes); a person says it now and then. The greeting and the summaries keep it.
 */
export function withoutName(text: string, firstName: string): string {
  if (!firstName) return text;
  const n = firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out = text
    .replace(new RegExp(`\\s*,\\s*${n}(?=\\s*[.!?])`, "g"), "")                                   // "..., Dmitrii."  -> "..."
    .replace(new RegExp(`(^|[.!?]\\s+)${n}\\s*,\\s*(\\w)`, "g"), (_m, a: string, b: string) => a + b.toUpperCase())   // "Dmitrii, let's" -> "Let's"
    .replace(new RegExp(`\\s*,\\s*${n}\\s*,\\s*`, "g"), ", ")                                      // "Yes, Dmitrii, I" -> "Yes, I"
    .replace(new RegExp(`\\s+${n}\\s*,`, "g"), ",")                                                 // "Yes Dmitrii, I"  -> "Yes, I"
    .replace(new RegExp(`\\s*\\b${n}\\b`, "g"), "")
    .replace(/\s+([.,!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
  return out.length >= 2 ? out : text;
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
    c.notCounted ? `Movements that did not count: ${c.notCounted}.` : null,
    c.quality !== null ? `Average quality so far: ${c.quality} out of 100.` : null,
    c.bestDegrees !== null ? `Best range this session: ${c.bestDegrees} degrees${c.previousDegrees !== null ? `, last time ${c.previousDegrees} degrees` : ""}.` : null,
    c.form ? `Form so far, as the camera saw it: ${c.form}` : null,
    c.lastCue ? `Last form tip given: "${c.lastCue}".` : null,
    c.condition ? `Their rehab: ${c.condition}.` : null,
    c.lastSession ? `Last session: ${c.lastSession}.` : null,
    c.memories.length ? `What you know about them: ${c.memories.join("; ")}.` : null,
    ...(c.liveFacts ?? []).map((f) => `Live fact: ${f}`),
  ].filter(Boolean).join("\n");
  const moment =
    event === "heard" ? `Moment: heard. They are in set ${c.set} of ${c.sets}. They said: "${(heard ?? "").slice(0, 300)}"`
      : event === "set_done" ? `Moment: set_done. They just finished set ${c.set} of ${c.sets}.`
        : event === "prepare" ? "Moment: prepare. Write the 5 lines now."
          : `Moment: ${event}.`;
  return [
    { role: "system" as const, content: VOICE_SYSTEM_PROMPT },
    { role: "user" as const, content: `${facts}\n${moment}\nYour spoken answer:` },
  ];
}

const WEATHER_WORDS = /\b(weather|temperature|degrees outside|rain(ing)?|snow(ing)?|sunny|cloudy|windy|forecast|cold out|hot out|outside)\b/i;
const WMO: Record<number, string> = {
  0: "clear sky", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "fog", 51: "light drizzle", 53: "drizzle",
  55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain", 71: "light snow",
  73: "snow", 75: "heavy snow", 77: "snow grains", 80: "rain showers", 81: "rain showers", 82: "heavy rain showers",
  85: "snow showers", 86: "heavy snow showers", 95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with hail",
};

/**
 * Facts the AI cannot know by itself: the local time always, and live weather when the question is about it
 * (Open-Meteo: free, no key, only the city name is sent). A city named in the question ("in Montreal") is used,
 * otherwise Toronto. Each lookup gives up after 1.5 s, so a slow weather service never holds up the answer for long.
 */
const KNOWN_PLACES: Record<string, { name: string; country: string; latitude: number; longitude: number }> = {
  toronto: { name: "Toronto", country: "Canada", latitude: 43.7064, longitude: -79.3986 },
};
const weatherCache = new Map<string, { at: number; fact: string }>();     // per city, 10 minutes

export async function liveFacts(heard: string | null): Promise<string[]> {
  const facts = [
    `the local time in Toronto is ${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "long", hour: "numeric", minute: "2-digit" }).format(new Date())}`,
  ];
  if (!heard || !WEATHER_WORDS.test(heard)) return facts;
  const named = heard.match(/\b(?:in|at|for)\s+([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,2})/);
  const city = named?.[1]?.replace(/[.?!,]+$/, "") ?? "Toronto";
  const cached = weatherCache.get(city.toLowerCase());
  if (cached && Date.now() - cached.at < 600_000) return [...facts, cached.fact];
  try {
    const place = KNOWN_PLACES[city.toLowerCase()] ?? ((await (await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=${encodeURIComponent(city)}`,
      { signal: AbortSignal.timeout(1500) })).json()) as { results?: { name: string; country?: string; latitude: number; longitude: number }[] }).results?.[0];
    if (!place) return [...facts, `no weather found for "${city}"`];
    const w = (await (await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto`,
      { signal: AbortSignal.timeout(1500) })).json()) as {
        current?: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number };
        daily?: { temperature_2m_max: number[]; temperature_2m_min: number[] };
      };
    const c = w.current;
    if (!c) return facts;
    const hi = w.daily?.temperature_2m_max?.[0], lo = w.daily?.temperature_2m_min?.[0];
    const fact = `live weather in ${place.name}${place.country ? `, ${place.country}` : ""} right now: ${Math.round(c.temperature_2m)} degrees Celsius, feels like ${Math.round(c.apparent_temperature)}, ${WMO[c.weather_code] ?? "mixed weather"}, wind ${Math.round(c.wind_speed_10m)} km/h` +
      (hi !== undefined && lo !== undefined ? `; today between ${Math.round(lo)} and ${Math.round(hi)} degrees` : "");
    weatherCache.set(city.toLowerCase(), { at: Date.now(), fact });
    facts.push(fact);
  } catch {
    facts.push(`the weather service did not answer; say you cannot check the weather right now`);
  }
  return facts;
}

/** When the AI is not available: still say something true and useful. */
export function fallbackLine(event: VoiceEvent, c: VoiceContext): string {
  if (event === "finished") return `Nice work, ${c.firstName}. That's ${c.repsDone} repetitions done today.`;
  if (event === "set_done") return `That's set ${c.set} done. Take a breather, then carry on.`;
  if (event === "start") return `Hi ${c.firstName}. Let's get started.`;
  if (event === "prepare") return `You've got this, ${c.firstName}.\nNice and steady.\nGreat control.\nKeep breathing.\nAlmost there, ${c.firstName}.`;
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

export async function voiceReply(
  event: VoiceEvent, heard: string | null, c: VoiceContext, opts: { keepLines?: boolean } = {},
): Promise<{ text: string; fromAi: boolean }> {
  const messages = buildVoiceMessages(event, heard, c);
  const clean = (t: string) => (opts.keepLines ? t.split(/\n+/).map(forSpeech).filter(Boolean).join("\n") : forSpeech(t));
  const fromOpenai = clean((await openaiChat(messages)) ?? "");
  if (fromOpenai.length >= 2) return { text: fromOpenai, fromAi: true };
  const cfg = adaptionConfig();
  if (!cfg) return { text: fallbackLine(event, c), fromAi: false };
  try {
    // Room for a model that thinks first (deepseek-v4-flash spends 150 to 300 tokens on it) if one is configured.
    const r = await chatText(cfg, messages, { model: VOICE_MODEL(), maxTokens: 1200, timeoutMs: 9000 });
    const text = clean(r.content ?? "");
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

/** The session page's permission to use our speech-to-text (api/stt.py) for three hours. Null without TTS_SECRET. */
export function sttTicket(): { exp: number; sig: string } | null {
  const secret = process.env.TTS_SECRET;
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + 3 * 3600;
  return { exp, sig: createHmac("sha256", secret).update(`stt.${exp}`).digest("hex") };
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
