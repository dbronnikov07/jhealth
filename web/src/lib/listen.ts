// Voice commands during a camera session: "help", "call 911", "call mom", "I'm okay", "it hurts".
//
// The browser turns speech into text (SpeechRecognition: Apple's speech service in Safari, Google's in Chrome), so the
// words leave the device for that; the video never does. Only these few commands do anything; everything else that is
// heard is ignored. The session ignores the microphone while the coach is talking (lib/voice.ts voiceBusy), so the
// coach's own "Should I call 911?" is never taken for the patient's.
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

type Recognition = {
  continuous: boolean; interimResults: boolean; lang: string;
  start(): void; stop(): void; abort?(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

export type ListenState = { on: boolean; error: string | null; pushing: boolean };

let rec: Recognition | null = null;
let wanted = false;
let running = false;
let handler: ((heard: string, final: boolean) => void) | null = null;
let state: ListenState = { on: false, error: null, pushing: false };
let pushUntil = 0;
const watchers = new Set<(s: ListenState) => void>();

function setState(next: Partial<ListenState>) {
  state = { ...state, ...next };
  watchers.forEach((w) => w(state));
}

const PERMANENT: Record<string, string> = {
  "not-allowed": "The microphone is blocked for this page. Allow it in the browser's settings, then tap Talk.",
  "service-not-allowed": "Speech recognition is off. On iPhone or iPad turn on Settings > Siri > Siri & Dictation (or Keyboard > Enable Dictation), then tap Talk.",
  "audio-capture": "No microphone was found.",
  "language-not-supported": "Speech recognition does not support English here.",
};

export function listenSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

function begin() {
  if (!rec || running) return;
  try {
    rec.start();
    running = true;
    setState({ on: true });
  } catch {
    // already started, or the browser wants a tap first: the Talk button starts it
  }
}

/** Start the microphone. Call it from a tap. Safe to call again. */
export function startListening(): void {
  if (!listenSupported()) {
    setState({ error: "This browser cannot turn speech into text. Use Safari on iPhone or iPad, or Chrome." });
    return;
  }
  wanted = true;
  if (!rec) {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const R = w.SpeechRecognition ?? w.webkitSpeechRecognition!;
    rec = new R();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      if (state.error) setState({ error: null });
      for (let i = e.resultIndex; i < e.results.length; i++) handler?.(e.results[i][0].transcript, e.results[i].isFinal);
    };
    // Browsers stop listening after a pause, after each sentence (Safari) or when sound plays; start again at once.
    rec.onend = () => {
      running = false;
      setState({ on: false });
      if (wanted) setTimeout(begin, 200);
    };
    rec.onerror = (e) => {
      if (PERMANENT[e.error]) {
        wanted = false;
        setState({ on: false, error: PERMANENT[e.error] });
      }
      // "no-speech", "aborted", "network": the end handler starts it again
    };
  }
  begin();
}

/** The Talk button: make sure the microphone is on (this is a tap, so the browser allows it) and treat the next
 *  sentence as meant for the coach for 8 s, even while the coach is talking. */
export function talkNow(): void {
  pushUntil = Date.now() + 8000;
  setState({ pushing: true, error: null });
  setTimeout(() => { if (Date.now() >= pushUntil) setState({ pushing: false }); }, 8100);
  if (state.error) { wanted = true; }
  startListening();
}

/** True during the 8 s after the Talk button was pressed. */
export function pushing(): boolean {
  return Date.now() < pushUntil;
}

/** What to do with heard text (the session sets it). `final` is false while the browser is still listening. */
export function onHeard(h: ((heard: string, final: boolean) => void) | null): void {
  handler = h;
}

/** Follow the microphone's state (for the "listening" label and errors). Returns the unsubscribe function. */
export function watchListening(w: (s: ListenState) => void): () => void {
  watchers.add(w);
  w(state);
  return () => { watchers.delete(w); };
}

export function stopListening(): void {
  wanted = false;
  handler = null;
  pushUntil = 0;
  try { rec?.stop(); } catch { /* already stopped */ }
  running = false;
  rec = null;
  setState({ on: false, pushing: false });
}
