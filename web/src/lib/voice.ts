// The coach's voice: short recorded clips (public/voice/*.mp3) played back to back.
//
// Why not the browser's speech synthesiser: it sounds robotic, and different on every device. The session only ever
// says about fifty short things (the count, the cues, a few set phrases), so they are recorded once with a natural
// voice (scripts/make-voice.py) and the same voice plays on every phone and laptop. Nothing is generated or sent
// anywhere while a patient exercises. To use a real person's voice, replace the files: public/voice/lines.json
// lists what each one says.
//
// One <audio> element plays everything. A phone lets a page make sound only after a tap, so unlockVoice() is called
// from the tap that starts the session; after that the element can be reused freely. (An <audio> element is also
// still heard when an iPhone's ringer switch is on silent, which Web Audio is not.)
//
// If a clip is missing or sound was never unlocked, playVoice() returns false and the caller falls back to the
// browser's own voice (lib/speech.ts), so the session is never silent because of a failed download.

/** Counted aloud up to here; a longer set falls back to the browser's voice for the higher numbers. */
export const COUNT_CLIPS = 30;
/** Exercises with their own "Camera's ready. Let's do ..." line. */
export const START_CLIPS = ["squat", "sit_to_stand", "arm_raise"];
/** Set phrases that are not cues. */
export const PHRASE_CLIPS = ["start", "halfway", "set_done", "all_done", "three_more", "two_more", "last_one", "idle", "not_counted_hands", "paused", "resumed"];
/** Said while the patient gets into the picture. */
export const SETUP_CLIPS = ["setup_find_you", "setup_step_back", "setup_step_back_arm", "setup_hold"];
/** One of these follows every third good repetition, so the count does not sound like a machine. */
export const MOTIVATION = ["m1", "m2", "m3", "m4", "m5"];
/** A possible fall, a call for help, and what follows. */
/** Said at once when the patient finishes a sentence, while the spoken coach's answer is being made. */
export const ACK_CLIPS = ["ack_ok", "ack_question", "ack_got_it"];
export const EMERGENCY_CLIPS = ["fall_check", "help_check", "ask_help", "tap_911", "tap_contact", "glad_ok", "told_physio", "pain_stop"];

/**
 * What to say after repetition number `rep`: the count, then the cue if a rule objected, then one line about where we
 * are: the set is done, "three more", "two more", "last one", halfway, or now and then some encouragement.
 * A person counting says "Seven. Great form.", not "Nice. That's seven." twenty times in a row.
 */
export function repClips(
  rep: number,
  fault: string | null,
  at: { leftInSet?: number; halfway?: boolean; setDone?: boolean; allDone?: boolean } = {},
): string[] {
  const clips = [`n${rep}`];
  if (fault) clips.push(fault);
  if (at.allDone) clips.push("all_done");
  else if (at.setDone) clips.push("set_done");
  else if (at.leftInSet === 1) clips.push("last_one");
  else if (at.leftInSet === 2) clips.push("two_more");
  else if (at.leftInSet === 3) clips.push("three_more");
  else if (!fault && at.halfway) clips.push("halfway");
  else if (!fault && rep % 3 === 0) clips.push(MOTIVATION[(rep / 3 - 1) % MOTIVATION.length]);
  return clips;
}

/** Every clip one session can need, to fetch while the camera starts. */
export function sessionClips(exerciseId: string, target: number, cues: string[]): string[] {
  const numbers = Array.from({ length: Math.min(target, COUNT_CLIPS) }, (_, i) => `n${i + 1}`);
  const start = START_CLIPS.includes(exerciseId) ? [`start_${exerciseId}`] : [];
  const notCounted = START_CLIPS.includes(exerciseId) ? [`not_counted_${exerciseId}`] : [];
  return [...numbers, ...cues, ...PHRASE_CLIPS, ...SETUP_CLIPS, ...MOTIVATION, ...EMERGENCY_CLIPS, ...ACK_CLIPS, ...start, ...notCounted];
}

// 0.05 s of silence: playing it inside the tap is what unlocks sound on phones. It is turned into a blob: address
// because the site's Content-Security-Policy allows media only from itself and from blob:, never from data:.
const SILENCE_WAV = "UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";
let silenceUrl: string | null = null;
function silence(): string {
  if (!silenceUrl) {
    const bytes = Uint8Array.from(atob(SILENCE_WAV), (c) => c.charCodeAt(0));
    silenceUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  }
  return silenceUrl;
}

let player: HTMLAudioElement | null = null;
let unlocked = false;
let queue: string[] = [];
let busy = false;
let lastEnded = 0;                              // when the last clip finished (performance.now)
const spoke: { start: number; end: number }[] = [];   // when the coach was audible, most recent last
const closeSpoke = () => { const s = spoke[spoke.length - 1]; if (s && s.end === Infinity) s.end = performance.now(); };

/** The share (0..1) of the time between two moments (performance.now) during which the coach was audible. */
export function spokeDuring(startMs: number, endMs: number): number {
  let overlap = 0;
  for (const s of spoke) overlap += Math.max(0, Math.min(endMs, s.end) - Math.max(startMs, s.start));
  return endMs > startMs ? Math.min(1, overlap / (endMs - startMs)) : 0;
}
let turn = 0;                                   // guards against a late "play() was interrupted" from an older clip
const loaded = new Map<string, string>();       // clip -> object URL, ready to play at once
const requested = new Set<string>();

function audio(): HTMLAudioElement | null {
  if (typeof window === "undefined" || typeof Audio === "undefined") return null;
  if (!player) {
    player = new Audio();
    player.preload = "auto";
    player.addEventListener("ended", () => { lastEnded = performance.now(); closeSpoke(); });
    player.addEventListener("pause", closeSpoke);
    player.addEventListener("ended", playNext);
    player.addEventListener("error", playNext);
  }
  return player;
}

function playNext(): void {
  const a = player;
  if (!a) return;
  const clip = queue.shift();
  const url = clip ? loaded.get(clip) : undefined;
  if (!url) {
    busy = false;
    return;
  }
  busy = true;
  const mine = ++turn;
  closeSpoke();
  spoke.push({ start: performance.now(), end: Infinity });
  while (spoke.length > 40) spoke.shift();
  a.src = url;
  a.play().catch((e: unknown) => {
    if ((e as { name?: string } | null)?.name === "NotAllowedError") {
      // The browser wants a tap first after all: stop trying, and let the caller's fallback voice take over.
      unlocked = false;
      queue = [];
      busy = false;
    } else if (mine === turn) {
      playNext();
    }
  });
}

/** Call from the tap that starts the session. Safe to call again. */
export function unlockVoice(): void {
  const a = audio();
  if (!a || unlocked || busy) return;
  a.src = silence();
  // Calling play() inside the tap is what counts. The silence itself may be cut short by the first real clip (or by
  // React remounting the session in development), so only an outright refusal means sound is still locked.
  unlocked = true;
  a.play().catch((e: unknown) => {
    if ((e as { name?: string } | null)?.name === "NotAllowedError") unlocked = false;
  });
}

/** Fetch clips ahead of time. Missing ones are simply never ready. */
export function preloadVoice(clips: string[]): void {
  if (typeof window === "undefined") return;
  for (const clip of clips) {
    if (requested.has(clip)) continue;
    requested.add(clip);
    fetch(`/voice/${clip}.mp3`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => { if (blob) loaded.set(clip, URL.createObjectURL(blob)); })
      .catch(() => { requested.delete(clip); });
  }
}

export function voiceReady(clips: string[]): boolean {
  return unlocked && clips.length > 0 && clips.every((clip) => loaded.has(clip));
}

/**
 * Say these clips back to back.
 *   "now"    stop whatever is being said and say this at once (a live warning);
 *   "next"   let the clip that is playing finish its word, drop anything still waiting, then say this (the count);
 *   "queue"  say it after everything already waiting.
 * Returns false and plays nothing when sound is locked or a clip is not loaded: the caller then uses its fallback.
 */
export function playVoice(clips: string[], when: "now" | "next" | "queue" = "queue"): boolean {
  if (!voiceReady(clips)) return false;
  if (when === "now") {
    queue = [...clips];
    player?.pause();
    playNext();
  } else {
    queue = when === "next" ? [...clips] : [...queue, ...clips];
    // `busy` can be stale if the system paused the sound (a call, the tab going to the background).
    if (!busy || player?.paused || player?.ended) playNext();
  }
  return true;
}

/**
 * Is the coach speaking, or did it just stop? The microphone ignores what it hears then, so the coach's own words
 * ("Should I call 911?") are never taken for the patient's.
 */
export function voiceBusy(): boolean {
  const synth = typeof window !== "undefined" && window.speechSynthesis?.speaking;
  return busy || !!synth || performance.now() - lastEnded < 1500;
}

/** Make speech made on the fly (an object URL) playable inside a list of clips, like a recorded line. */
export function registerUrl(url: string): void {
  loaded.set(url, url);
}

/** Play speech that was made on the fly (the spoken coach's answer, an object URL). False if sound is locked. */
export function playUrl(url: string, when: "now" | "next" | "queue" = "queue"): boolean {
  if (!unlocked) return false;
  loaded.set(url, url);
  return playVoice([url], when);
}

export function stopVoice(): void {
  queue = [];
  busy = false;
  turn++;
  player?.pause();
}
