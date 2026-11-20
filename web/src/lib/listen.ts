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

export type Command = "call_911" | "call_contact" | "help" | "okay" | "pain" | "pause" | "resume";

/** Which command, if any, a piece of heard text is. `contactName` is the emergency contact ("Mom", "Anna Lee"). */
export function matchCommand(heard: string, contactName: string | null = null): Command | null {
  const t = ` ${heard.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()} `;
  // "Don't call 911" must never read as "call 911", nor "I don't need help" as "help".
  if (/ (don't|dont|do not|no need to|not|never|no) (call|dial|phone|ring) /.test(t) || / (don't|dont|do not) need (any )?help /.test(t)) {
    return / (i'm|i am|im) (ok|okay|fine|all right|alright|good) /.test(t) ? "okay" : null;
  }
  if (/ (call|dial|phone|get) (9 ?1 ?1|nine one one|911|an ambulance|ambulance|emergency|emergency services) /.test(t)) return "call_911";
  const names = ["mom", "mum", "mommy", "mother", "dad", "daddy", "father", "my parents?", "my contact", "my emergency contact", "emergency contact"];
  const first = contactName?.toLowerCase().replace(/[^a-z ]+/g, "").trim().split(" ")[0];
  if (first && first.length >= 2) names.push(first);
  if (new RegExp(` (call|phone|ring) (${names.join("|")}) `).test(t)) return "call_contact";
  if (/ (help me|i need help|help|i fell|i've fallen|i have fallen|i fell down|i can't get up|i cannot get up) /.test(t)) return "help";
  if (/ (i'm|i am|im) (ok|okay|fine|all right|alright|good) /.test(t) || /^ (ok|okay|fine|i'm fine) $/.test(t)) return "okay";
  if (/ (it hurts|that hurts|it's hurting|ouch|pain) /.test(t)) return "pain";
  // Pause and resume only as a short phrase of their own, so "should I pause between reps?" stays a question.
  const words = t.trim().split(" ").length;
  if (words <= 5 && / (pause|take a break|i need a break|give me a (minute|second|moment)|wait a (minute|second|moment)|hold on|stop the camera|camera off|turn off the camera) /.test(t)) return "pause";
  if (words <= 5 && / (resume|continue|i'm back|i am back|im back|let's continue|lets continue|let's go|keep going|camera on|turn on the camera|start again|i'm ready|i am ready) /.test(t)) return "resume";
  return null;
}

/**
 * The answer to "Are you okay? Should I call 911?" after a possible fall: "no" (I'm fine, it's a demo, don't call),
 * "yes" (call, help, I'm hurt), or null when it is neither. Order matters: "No, I'm not okay" is a yes, and
 * "No, no, don't call it, it's a demo" says "call" but is a no.
 */
export function emergencyAnswer(heard: string): "yes" | "no" | null {
  const t = ` ${heard.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()} `;
  if (/ (not (ok|okay|fine|good|alright|all right)|can't get up|cannot get up|can not get up|i'm hurt|i am hurt|it hurts|hurts|i fell|i'm bleeding|bleeding|can't move|cannot move) /.test(t)) return "yes";
  if (/ (no|nope|nah|don't|dont|do not|no need|not needed|false alarm|never mind|nevermind|cancel|i'm (ok|okay|fine|good|alright|all right)|i am (ok|okay|fine|good|alright|all right)|im (ok|okay|fine|good)|all good|i'm good|it's (a |just a )?(demo|test|drill)|its (a |just a )?(demo|test|drill)|demo|just a test|just testing|on purpose) /.test(t)) return "no";
  if (/ (yes|yeah|yep|yup|please|call|help|ambulance|911|9 1 1|nine one one|emergency) /.test(t)) return "yes";
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

  private o = { minRms: 0.008, ratio: 3.2, endQuietFrames: 22, minLoudFrames: 10, maxFrames: 500 };

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
let voiceBase = "";                          // "" = this site; "http://127.0.0.1:8799" = the fast voice helper on this laptop
let coachSpeaking: () => boolean = () => false;
let stream: MediaStream | null = null;
let node: AudioNode | null = null;
let capture: "worklet" | "script" | null = null;
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

/** Where the speech functions live: this site, or the fast voice helper on this laptop (see findVoiceServer). */
export function setVoiceBase(base: string): void {
  voiceBase = base;
}
export function getVoiceBase(): string {
  return voiceBase;
}

const LOCAL_VOICE = "http://127.0.0.1:8799";
let remoteVoice = "";                        // the team's fast voice helper, reached through its tunnel (from our server)

/** The fast voice helper's public address, when it is running (the session page gets it from our server). */
export function setRemoteVoice(url: string | null): void {
  remoteVoice = url && /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(url) ? url : "";
  if (voiceBase !== LOCAL_VOICE) voiceBase = remoteVoice;
}
const FAST_VOICE_KEY = "motiva.fastVoice";

/** Is this browser set up to use the fast voice helper on this laptop (the /fast-voice page turns it on)? Off by
 *  default: looking for it on a stranger's laptop would make Chrome ask them about devices on their network. */
export function fastVoiceWanted(): boolean {
  try {
    return localStorage.getItem(FAST_VOICE_KEY) === "1";
  } catch {
    return false;
  }
}
export function setFastVoiceWanted(on: boolean): void {
  try {
    if (on) localStorage.setItem(FAST_VOICE_KEY, "1");
    else localStorage.removeItem(FAST_VOICE_KEY);
  } catch {
    // private window: stays off
  }
}

/**
 * The fast voice helper (npm run voice:start) runs speech to text and the coach's voice on this laptop: about 0.05 s
 * and 0.2-0.4 s instead of 0.8 s and 1.5-3.5 s on our server. Used when this browser asked for it and it answers;
 * otherwise the server.
 */
export async function findVoiceServer(force = false): Promise<string> {
  if (!force && !fastVoiceWanted()) return voiceBase;
  try {
    const res = await fetch(`${LOCAL_VOICE}/api/tts`, { method: "GET", signal: AbortSignal.timeout(1500) });
    if (res.status === 204) {
      voiceBase = LOCAL_VOICE;
      return voiceBase;
    }
  } catch {
    // not running on this computer: the helper through its tunnel if there is one, else the server
  }
  voiceBase = remoteVoice;
  return voiceBase;
}

/** A request to the speech functions: the fast helper when it is on, else our server. If the helper stops answering
 *  mid-session, this request and the ones after it go to the server. */
export async function voiceFetch(path: "/api/tts" | "/api/stt", init: RequestInit): Promise<Response | null> {
  const base = voiceBase;
  try {
    // The helper answers in well under a second; if it has not in 5 s, it is gone, and the server takes over.
    const res = await fetch(`${base}${path}`, base ? { ...init, signal: AbortSignal.timeout(5000) } : init);
    if (res.ok || !base) return res;
  } catch {
    if (!base) return null;
  }
  if (voiceBase === base) voiceBase = "";
  return fetch(path, init).catch(() => null);
}

/** While the coach is speaking, the detector needs a louder voice to start, so a trace of the coach's own voice
 *  that echo cancellation missed does not count as the patient talking. */
export function setCoachSpeaking(f: () => boolean): void {
  coachSpeaking = f;
}

/** Is the patient talking right now? */
export function isHearing(): boolean {
  return state.hearing;
}

async function transcribe(u: Utterance): Promise<void> {
  if (!ticket) return;
  const pcm = new Int16Array(u.audio.length);
  for (let i = 0; i < u.audio.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(u.audio[i] * 32768)));
  setState({ working: true });
  try {
    const res = await voiceFetch("/api/stt", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "x-exp": String(ticket.exp), "x-sig": ticket.sig },
      body: pcm.buffer,
    });
    if (!res?.ok) return;
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
  let input = frame;
  if (!vad.active && coachSpeaking()) {
    input = new Float32Array(frame.length);
    for (let i = 0; i < frame.length; i++) input[i] = frame[i] * 0.45;
  }
  const u = vad.push(input, performance.now());
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
  // 16 kHz from the start: the browser then converts the microphone's 44 or 48 kHz properly (with a filter).
  // Created inside the tap, as phones require.
  const make16k = () => { try { return new AC({ sampleRate: 16000 }); } catch { return new AC(); } };
  ctx = ctx ?? make16k();
  void ctx.resume();
  navigator.mediaDevices
    .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false })
    .then((s) => connectMicrophone(s, AC))
    .catch((e: unknown) => {
      const name = (e as { name?: string } | null)?.name ?? "";
      setState({ on: false, error: MIC_ERRORS[name] ?? "The microphone could not start. Tap Talk to try again." });
    })
    .finally(() => { starting = false; });
}

/** Wire a microphone stream into the detector: on the audio thread where the browser can (no lost samples), else the old way. */
async function connectMicrophone(s: MediaStream, AC: typeof AudioContext): Promise<void> {
  stream = s;
  let source: MediaStreamAudioSourceNode;
  try {
    source = ctx!.createMediaStreamSource(s);
  } catch {
    // Firefox cannot join a 16 kHz context to a 48 kHz microphone: use the device's own rate and convert here.
    ctx = new AC();
    void ctx.resume();
    source = ctx.createMediaStreamSource(s);
  }
  const c = ctx!;
  const resampler = new Resampler(c.sampleRate);
  const feed = (chunk: Float32Array) => resampler.push(chunk, onFrame);
  const mute = c.createGain();
  mute.gain.value = 0;                       // the capture node must reach the output to run; nothing is played
  const forceOld = typeof window !== "undefined" && (window as unknown as { __motivaOldCapture?: boolean }).__motivaOldCapture === true;
  try {
    if (forceOld || !c.audioWorklet) throw new Error("no worklet");
    await c.audioWorklet.addModule("/listen-worklet.js");
    const w = new AudioWorkletNode(c, "motiva-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
    w.port.onmessage = (e: MessageEvent<Float32Array>) => feed(e.data);
    source.connect(w);
    w.connect(mute);
    node = w;
    capture = "worklet";
  } catch {
    const sp = c.createScriptProcessor(4096, 1, 1);
    sp.onaudioprocess = (e) => feed(e.inputBuffer.getChannelData(0));
    source.connect(sp);
    sp.connect(mute);
    node = sp;
    capture = "script";
  }
  mute.connect(c.destination);
  setState({ on: true, error: null });
}

/** How the microphone is being read: "worklet" (audio thread) or "script" (older browsers). For diagnostics. */
export function captureMode(): string | null {
  return capture ? `${capture} @ ${ctx?.sampleRate ?? 0} Hz` : null;
}

/**
 * Development only: use a sound file as the microphone, through the SAME capture path as a real one (audio thread
 * and all), so capture can be tested while the page is busy tracking a video.
 */
export async function fakeMicrophoneForTest(url: string): Promise<void> {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  node?.disconnect();
  node = null;
  stream?.getTracks().forEach((t) => t.stop());
  try { ctx = new AC({ sampleRate: 16000 }); } catch { ctx = new AC(); }
  const c = ctx;
  await c.resume();
  const buf = await c.decodeAudioData(await (await fetch(url)).arrayBuffer());
  const dest = c.createMediaStreamDestination();
  await connectMicrophone(dest.stream, AC);
  const play = c.createBufferSource();
  play.buffer = buf;
  play.connect(dest);
  play.start(c.currentTime + 0.6);
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
