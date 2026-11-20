// Hearing the patient during a camera session: commands ("help", "call 911", "call mom", "I'm okay", "it hurts") and
// anything else they say to the coach.
//
// The page records the microphone itself, with the browser's echo cancellation on (so the coach's own voice is taken
// out), finds where someone speaks (Vad below), and posts each utterance to our own speech-to-text (api/stt.py,
// Whisper). This works in every browser. The browser's built-in speech recognition, used before, exists only in some
// browsers, needs Dictation switched on in Safari, and in our tests on a laptop and an iPad it never returned a
// single sentence. The audio is transcribed and dropped; the video never leaves the device.
//
// Like sound, the microphone must be started by a tap: startListening() is called from the "Start with camera" tap.

export type Command = "call_911" | "call_contact" | "help" | "okay" | "pain";

/** Which command, if any, a piece of heard text is. `contactName` is the emergency contact ("Mom", "Anna Lee"). */
export function matchCommand(heard: string, contactName: string | null = null): Command | null {
  const t = ` ${heard.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()} `;
  if (/ (call|dial|phone|get) (9 ?1 ?1|nine one one|911|an ambulance|ambulance|emergency|emergency services) /.test(t)) return "call_911";
  const names = ["mom", "mum", "mommy", "mother", "dad", "daddy", "father", "my parents?", "my contact", "my emergency contact", "emergency contact"];
  const first = contactName?.toLowerCase().replace(/[^a-z ]+/g, "").trim().split(" ")[0];
  if (first && first.length >= 2) names.push(first);
  if (new RegExp(` (call|phone|ring) (${names.join("|")}) `).test(t)) return "call_contact";
  if (/ (help me|i need help|help|i fell|i've fallen|i have fallen|i fell down|i can't get up|i cannot get up) /.test(t)) return "help";
  if (/ (i'm|i am|im) (ok|okay|fine|all right|alright|good) /.test(t) || /^ (ok|okay|fine|i'm fine) $/.test(t)) return "okay";
  if (/ (it hurts|that hurts|it's hurting|ouch|pain) /.test(t)) return "pain";
  return null;
}

// ---------------------------------------------------------------- finding speech in the microphone signal

export type Utterance = { audio: Float32Array; startMs: number; endMs: number };

/**
 * Voice activity detection on 20 ms frames of 16 kHz audio: loud enough above the room's own noise for long enough
 * is speech; half a second of quiet ends it. Pure (no browser APIs), unit-tested in scripts/listen.test.ts.
 */
export class Vad {
  static readonly FRAME = 320;                 // 20 ms at 16 kHz
  private floor = 0.004;                       // the room's noise level (RMS), follows slowly
  private recent: boolean[] = [];              // was each of the last 10 frames loud?
  private pre: Float32Array[] = [];            // the last 300 ms, kept so the first syllable is not cut off
  private parts: Float32Array[] = [];
  private speaking = false;
  private quiet = 0;
  private loudFrames = 0;
  private startMs = 0;

  private o = { minRms: 0.008, ratio: 3.2, endQuietFrames: 27, minLoudFrames: 10, maxFrames: 500 };

  get active(): boolean {
    return this.speaking;
  }

  /** One 20 ms frame. Returns the finished utterance when one just ended. */
  push(frame: Float32Array, nowMs: number): Utterance | null {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    const threshold = Math.max(this.o.minRms, this.floor * this.o.ratio);
    const loud = rms > (this.speaking ? threshold * 0.6 : threshold);
    // The noise level follows quiet frames quickly and loud ones very slowly, so speech does not raise it.
    this.floor += (rms - this.floor) * (rms < this.floor ? 0.2 : this.speaking ? 0.0005 : 0.01);
    this.recent.push(loud);
    if (this.recent.length > 10) this.recent.shift();

    if (!this.speaking) {
      this.pre.push(frame);
      if (this.pre.length > 15) this.pre.shift();
      if (this.recent.filter(Boolean).length >= 6) {
        this.speaking = true;
        this.parts = [...this.pre];
        this.pre = [];
        this.quiet = 0;
        this.loudFrames = 6;
        this.startMs = nowMs - this.parts.length * 20;
      }
      return null;
    }
    this.parts.push(frame);
    if (loud) { this.loudFrames++; this.quiet = 0; } else this.quiet++;
    if (this.quiet < this.o.endQuietFrames && this.parts.length < this.o.maxFrames) return null;

    const enough = this.loudFrames >= this.o.minLoudFrames;
    const keep = this.parts.slice(0, Math.max(1, this.parts.length - Math.max(0, this.quiet - 8)));   // trim trailing quiet
    this.speaking = false;
    this.recent = [];
    if (!enough) return null;                                // a click or a cough, not a sentence
    const audio = new Float32Array(keep.length * Vad.FRAME);
    keep.forEach((f, i) => audio.set(f, i * Vad.FRAME));
    return { audio, startMs: this.startMs, endMs: nowMs };
  }
}

/** Turns audio at the device's sample rate into 20 ms frames at 16 kHz (linear interpolation). */
export class Resampler {
  private pos = 0;
  private last = 0;
  private frame = new Float32Array(Vad.FRAME);
  private n = 0;
  private inRate: number;

  constructor(inRate: number) {
    this.inRate = inRate;
  }

  push(input: Float32Array, onFrame: (frame: Float32Array) => void): void {
    const step = this.inRate / 16000;
    for (;;) {
      const i = Math.floor(this.pos);
      if (i >= input.length) break;
      const a = i === 0 ? this.last : input[i - 1];
      const frac = this.pos - i;
      this.frame[this.n++] = a + (input[i] - a) * frac;
      if (this.n === Vad.FRAME) {
        onFrame(this.frame);
        this.frame = new Float32Array(Vad.FRAME);
        this.n = 0;
      }
      this.pos += step;
    }
    this.pos -= input.length;
    this.last = input[input.length - 1] ?? this.last;
  }
}

// ---------------------------------------------------------------- the microphone

export type ListenState = { on: boolean; error: string | null; pushing: boolean; hearing: boolean; working: boolean };
export type Ticket = { exp: number; sig: string };
type Handler = (heard: string, when: { startMs: number; endMs: number }) => void;

let ctx: AudioContext | null = null;
let stream: MediaStream | null = null;
let node: ScriptProcessorNode | null = null;
let vad = new Vad();
let ticket: Ticket | null = null;
let handler: Handler | null = null;
let state: ListenState = { on: false, error: null, pushing: false, hearing: false, working: false };
let pushUntil = 0;
let starting = false;
const watchers = new Set<(s: ListenState) => void>();

function setState(next: Partial<ListenState>) {
  const merged = { ...state, ...next };
  if (Object.keys(merged).every((k) => merged[k as keyof ListenState] === state[k as keyof ListenState])) return;
  state = merged;
  watchers.forEach((w) => w(state));
}

const MIC_ERRORS: Record<string, string> = {
  NotAllowedError: "The microphone is blocked for this page. Allow it (the lock or camera icon next to the address), then tap Talk.",
  NotFoundError: "No microphone was found on this device.",
  NotReadableError: "Another app is using the microphone. Close it, then tap Talk.",
};

export function listenSupported(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && (!!window.AudioContext || "webkitAudioContext" in window);
}

/** The session page's permission to use our speech-to-text for a few hours (signed by the server). */
export function configureListening(t: Ticket | null): void {
  ticket = t;
}

async function transcribe(u: Utterance): Promise<void> {
  if (!ticket) return;
  const pcm = new Int16Array(u.audio.length);
  for (let i = 0; i < u.audio.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(u.audio[i] * 32768)));
  setState({ working: true });
  try {
    const res = await fetch("/api/stt", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "x-exp": String(ticket.exp), "x-sig": ticket.sig },
      body: pcm.buffer,
    });
    if (!res.ok) return;
    const { text } = (await res.json()) as { text?: string };
    if (text && text.trim()) handler?.(text.trim(), { startMs: u.startMs, endMs: u.endMs });
  } catch {
    // no answer this time
  } finally {
    setState({ working: false });
  }
}

/** One 20 ms frame of 16 kHz audio into the detector (also used by the tests and the development feed). */
function onFrame(frame: Float32Array): void {
  const u = vad.push(frame, performance.now());
  setState({ hearing: vad.active });
  if (u) void transcribe(u);
}

/** Start the microphone. Call it from a tap. Safe to call again. */
export function startListening(): void {
  if (!listenSupported()) {
    setState({ error: "This browser cannot use the microphone here." });
    return;
  }
  if (stream || starting) {
    void ctx?.resume();
    return;
  }
  starting = true;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx = ctx ?? new AC();                       // created inside the tap, as phones require
  void ctx.resume();
  navigator.mediaDevices
    .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false })
    .then((s) => {
      stream = s;
      const source = ctx!.createMediaStreamSource(s);
      const resampler = new Resampler(ctx!.sampleRate);
      node = ctx!.createScriptProcessor(2048, 1, 1);
      node.onaudioprocess = (e) => resampler.push(e.inputBuffer.getChannelData(0), onFrame);
      const mute = ctx!.createGain();
      mute.gain.value = 0;                     // the processor must reach the output to run; nothing is played
      source.connect(node);
      node.connect(mute);
      mute.connect(ctx!.destination);
      setState({ on: true, error: null });
    })
    .catch((e: unknown) => {
      const name = (e as { name?: string } | null)?.name ?? "";
      setState({ on: false, error: MIC_ERRORS[name] ?? "The microphone could not start. Tap Talk to try again." });
    })
    .finally(() => { starting = false; });
}

/** The Talk button: make sure the microphone is on (this is a tap, so the browser allows it) and treat the next
 *  sentence as meant for the coach for 8 s, even if it is a single word. */
export function talkNow(): void {
  pushUntil = Date.now() + 8000;
  setState({ pushing: true, error: null });
  setTimeout(() => { if (Date.now() >= pushUntil) setState({ pushing: false }); }, 8100);
  startListening();
}

/** True during the 8 s after the Talk button was pressed. */
export function pushing(): boolean {
  return Date.now() < pushUntil;
}

/** What to do with a heard sentence (the session sets it). */
export function onHeard(h: Handler | null): void {
  handler = h;
}

/** Follow the microphone's state (for the "listening" label and errors). Returns the unsubscribe function. */
export function watchListening(w: (s: ListenState) => void): () => void {
  watchers.add(w);
  w(state);
  return () => { watchers.delete(w); };
}

export function stopListening(): void {
  handler = null;
  pushUntil = 0;
  node?.disconnect();
  node = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  vad = new Vad();
  setState({ on: false, pushing: false, hearing: false, working: false });
}

/**
 * Development only: play a sound file into the listener as if it came from the microphone, in real time, so the
 * whole path (detecting speech, speech to text, the coach's answer) can be tested without a microphone.
 */
export async function feedAudioForTest(url: string): Promise<void> {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const c = new AC();
  const buf = await c.decodeAudioData(await (await fetch(url)).arrayBuffer());
  const resampler = new Resampler(buf.sampleRate);
  const data = buf.getChannelData(0);
  const chunk = Math.round(buf.sampleRate * 0.02);
  const silence = new Float32Array(chunk);
  setState({ on: true });
  await new Promise<void>((done) => {
    let i = -25 * chunk;                                    // half a second of quiet first, and one second after
    const timer = setInterval(() => {
      const part = i < 0 || i >= data.length ? silence : data.subarray(i, i + chunk);
      resampler.push(part, onFrame);
      i += chunk;
      if (i > data.length + 50 * chunk) { clearInterval(timer); done(); }
    }, 20);
  });
  void c.close();
}
