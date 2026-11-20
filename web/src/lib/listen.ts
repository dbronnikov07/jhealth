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
  start(): void; stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

let rec: Recognition | null = null;
let wanted = false;
let handler: ((heard: string, final: boolean) => void) | null = null;
let listening = false;
const watchers = new Set<(on: boolean) => void>();

function setListening(on: boolean) {
  if (on === listening) return;
  listening = on;
  watchers.forEach((w) => w(on));
}

export function listenSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

/** Start the microphone. Call it from a tap. Safe to call again. */
export function startListening(): void {
  if (!listenSupported()) return;
  wanted = true;
  if (rec) return;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const R = w.SpeechRecognition ?? w.webkitSpeechRecognition!;
  rec = new R();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";
  rec.onresult = (e) => {
    setListening(true);
    for (let i = e.resultIndex; i < e.results.length; i++) handler?.(e.results[i][0].transcript, e.results[i].isFinal);
  };
  // Browsers stop listening after a pause; start again for as long as the session wants it.
  rec.onend = () => {
    setListening(false);
    if (wanted && rec) {
      try { rec.start(); setListening(true); } catch { /* it will be started by the next tap */ }
    }
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      wanted = false;
      setListening(false);
    }
  };
  try {
    rec.start();
    setListening(true);
  } catch {
    rec = null;
  }
}

/** What to do with heard text (the session sets it). `final` is false while the browser is still listening. */
export function onHeard(h: ((heard: string, final: boolean) => void) | null): void {
  handler = h;
}

/** Follow whether the microphone is on (for the "listening" label). Returns the unsubscribe function. */
export function watchListening(w: (on: boolean) => void): () => void {
  watchers.add(w);
  w(listening);
  return () => { watchers.delete(w); };
}

export function stopListening(): void {
  wanted = false;
  handler = null;
  try { rec?.stop(); } catch { /* already stopped */ }
  rec = null;
  setListening(false);
}
