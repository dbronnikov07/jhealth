"use client";
// The live camera session. Everything runs on the patient's device: the video never leaves it.
// Per frame:      pose tracker (MediaPipe) -> the exercise's rep signal -> rep counter, skeleton, live warning
// Per repetition: the exported model scores it (features.ts + model.ts), the rules name any mistake (exercises.ts)
// At the end:     only the numbers are sent to /api/session.
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { CHECKS, CUE, HANDS_NOT_COUNTED, NOT_COUNTED_FAULTS, barelyMoved, countsAsRep, hipDropShare, profileFor, ruleQuality, trunkLean, withModelFlag, type Fault, type ScreenTrack } from "@/lib/pose/exercises";
import { repFeatures, type Frame, type Vec } from "@/lib/pose/features";
import { ANALYSIS_INTERVAL_MS, cameraConstraints, DURING_SET, isPhoneDevice, poseSetupIssue, SHORT_GAP_SECONDS } from "@/lib/pose/camera";
import { bentElbowNow, focusSide, fpsOf, LIVE_GOALS, liveCoach, type LiveState, type LiveTone } from "@/lib/pose/live";
import { describeModel, loadModel } from "@/lib/pose/loader";
import { mistakeProbability } from "@/lib/pose/model";
import { RepCounter } from "@/lib/pose/reps";
import { coachVoice, repSpokenText } from "@/lib/speech";
import { meantForCoach, isEcho, looksLikeNoise, rememberSaid } from "@/lib/echo";
import { playUrl, playVoice, preloadVoice, repClips, sessionClips, spokeDuring, stopVoice, voiceBusy, voiceReady } from "@/lib/voice";
import { captureMode, emergencyAnswer, fakeMicrophoneForTest, fastVoiceWanted, feedAudioForTest, findVoiceServer, getVoiceBase, isHearing, matchCommand, onHeard, pushing, setCoachSpeaking, stopListening, talkNow, voiceFetch, watchListening, type ListenState } from "@/lib/listen";
import { fallPicture, FallWatch } from "@/lib/pose/fall";

export type RepResult = { quality: number | null; fault: Fault | null; knee_bend_deg: number | null; rom_deg: number | null; duration_s: number };
export type SessionSummary = { reps: number; quality: number | null; knee_bend: number | null; previous_knee_bend: number | null };

type Props = {
  token: string;
  exerciseId: string;
  exerciseName: string;
  sets: number;
  reps: number;
  modelKey: string | null;
  source: string | null;          // a video file instead of the camera (testing, or a stage fallback)
  step?: boolean;                 // with a video file: process it frame by frame (15 per video second), not in real time
  onDone: (summary: SessionSummary | null) => void;
  onPain: (message: string) => void;
  /** Who the "Call" button rings after a possible fall or a call for help (set by the physiotherapist), if anyone. */
  emergency?: { name: string; phone: string } | null;
};

/** The "Are you okay?" screen: why it opened, and which call the patient asked for out loud. */
type Emergency = { reason: "fall" | "help"; asked: "none" | "911" | "contact" };

type Status = "loading" | "running" | "paused" | "saving" | "error";

function speak(text: string, interrupt = false) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (interrupt) window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voice = coachVoice(window.speechSynthesis.getVoices());
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  }
  // Slow enough to be calming during movement, but not so slow that a live
  // safety cue arrives after the patient has already finished the rep.
  u.rate = 0.94;
  u.pitch = 0.98;
  u.volume = 0.9;
  window.speechSynthesis.speak(u);
}

/**
 * Say something in the coach's recorded voice (lib/voice.ts). `text` is what the browser's own voice says instead
 * when the recording is not available: sound was never unlocked by a tap, or a clip did not download.
 */
/**
 * Why the coach should wait a moment before counting or cueing out loud: the patient is "talking", or their question
 * waits for its "answer". The line is kept and said as soon as that is over (see `held`), never silently dropped:
 * the phone stands two metres away, so what is only on the screen is as good as not said.
 */
let holdSpeech: () => "talking" | "answer" | null = () => null;
/** The newest count or cue that had to wait, and since when. */
let held: { clips: string[]; text: string; when: "next" | "queue"; at: number } | null = null;
/** The count and the cues are short and matter: until this time, noise in the room does not cut them off. */
let cueUntil = 0;

/** One line of the on-screen form log: a counted repetition, or a movement that did not count and why. */
type LogRow = { n: number | null; score: number | null; text: string; tone: "good" | "warn" | "bad"; fault: Fault | null; small: boolean };

function say(clips: string[], text: string, when: "now" | "next" | "queue" = "queue") {
  if (when !== "now" && holdSpeech()) {
    held = { clips, text, when, at: performance.now() };
    return;
  }
  held = null;
  rememberSaid(text);
  cueUntil = performance.now() + 500 + 900 * Math.max(1, clips.length);
  if (playVoice(clips, when)) {
    if (when !== "queue" && typeof window !== "undefined") window.speechSynthesis?.cancel();
    return;
  }
  if (when !== "queue") stopVoice();
  speak(text, when !== "queue");
}

export function CameraSession(p: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopRef = useRef<() => void>(() => {});
  const finishRef = useRef<(reason: "target" | "ended") => void>(() => {});
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<RepResult[]>([]);
  const [bend, setBend] = useState<number | null>(null);
  const [banner, setBanner] = useState<{ text: string; tone: LiveTone } | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [modelNote, setModelNote] = useState<string | null>(null);
  const [setupIssue, setSetupIssue] = useState<string | null>("Checking that the camera can see the joints needed for this exercise…");
  const [emergency, setEmergency] = useState<Emergency | null>(null);
  const [listen, setListen] = useState<ListenState>({ on: false, error: null, pushing: false, hearing: false, working: false });
  const listening = listen.on;
  const [heardLive, setHeardLive] = useState<string>("");
  // The spoken conversation, shown under the video: what the patient said and what the coach answered.
  const [turns, setTurns] = useState<{ who: "you" | "coach"; text: string }[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [pausedUi, setPausedUi] = useState(false);
  const [voicePath, setVoicePath] = useState("");      // which speech servers this session is using, shown small
  const pauseRef = useRef<(on: boolean) => void>(() => {});
  const okayRef = useRef<() => void>(() => {});
  const lastWordsRef = useRef(false);     // the coach is saying its last words (after "it hurts"): do not cut them off
  const hurtsRef = useRef<() => void>(() => {});
  const target = p.sets * p.reps;

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let landmarker: { detectForVideo(v: HTMLVideoElement, t: number): unknown; close(): void } | null = null;
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const profile = profileFor(p.exerciseId);
    preloadVoice(sessionClips(p.exerciseId, target, Object.keys(CUE)));   // small files; ready before the first repetition
    // Wake the voice server while the camera starts, and keep it awake during the session (a cold start costs ~3 s).
    const warm = () => { for (const u of ["/api/tts", "/api/stt"]) fetch(`${getVoiceBase()}${u}`, { method: "GET" }).catch(() => {}); };
    // On the demo laptop (fast voice turned on at /fast-voice) the helper may still be starting: look again for a minute.
    let helperLooks = 0;
    let helperTimer = 0;
    const lookForHelper = () => {
      void findVoiceServer().then((base) => {
        if (base || helperLooks === 0) warm();
        if (!base && fastVoiceWanted() && ++helperLooks < 12 && !finished && !cancelled) helperTimer = window.setTimeout(lookForHelper, 5000);
      });
    };
    lookForHelper();
    const keepWarm = window.setInterval(() => { if (!finished) warm(); }, 25_000);   // an idle speech model answers its next request seconds late
    // Which speech servers are in use (the fast helper, or our hosted ones), and how the microphone is read.
    const showVoicePath = () => {
      const base = getVoiceBase();
      setVoicePath(`${!base ? "standard voice" : base.includes("127.0.0.1") ? "fast voice, this computer" : "fast voice"}${captureMode() ? ` · mic ${captureMode()}` : ""}`);
    };
    const voicePathTimer = window.setInterval(showVoicePath, 3000);
    const counter = new RepCounter(profile.counter);
    const frames: Frame[] = [];
    const kneesInFlags: boolean[] = [];
    const screenTrack: ScreenTrack[] = [];     // per frame, beside `frames`: where the hips are in the picture
    const repResults: RepResult[] = [];
    const started = new Date();
    let lastVideoTime = -1;
    let lastTs = 0;
    let kneesInRun = 0;
    let cueSpokenThisRep = false;
    let lastSpokenCue = 0;
    let lastAnalysisTs = -Infinity;
    let stableFrames = 0;
    let needsCounterReset = false;
    let lastGoodT = -Infinity;   // session time of the last frame that counted, for riding out short tracking gaps
    let startSpoken = false;
    let lastSetupIssue = "Checking that the camera can see the joints needed for this exercise…";
    let finished = false;
    // Live coaching (lib/pose/live.ts): the goal for this exercise, and what happened so far in this repetition.
    const goal = LIVE_GOALS[p.exerciseId] ?? null;
    const mirrored = !p.source;
    let reachedThisRep = false;
    let elbowRun = 0;
    let repCue: { text: string; tone: LiveTone } | null = null;
    let repCueUntil = 0;
    let lastBanner = "";
    let lastFps = 0;
    const frameClock: number[] = [];
    // Talking the patient into the picture: what the camera check shows on screen is also said out loud, once when it
    // changes and again every 9 s while it stays the same, so a patient standing 2 m away hears what to do.
    const SETUP_TEXT = {
      setup_find_you: "I can't see you yet. Stand in front of the camera.",
      setup_step_back: "Step back a little. I need to see you from your shoulders down to your knees.",
      setup_step_back_arm: "Step back a little, so I can see your arms and your hips.",
      setup_hold: "That's it. Hold still for a second.",
    };
    let setupSaid = { clip: "", at: 0 };
    let playingSince = 0;
    const coachSetup = (clip: keyof typeof SETUP_TEXT) => {
      const now = performance.now();
      if (!playingSince || now - playingSince < 2500) return;       // the camera is still waking up
      const again = clip !== "setup_hold" && now - setupSaid.at > 9000;
      if (clip === setupSaid.clip && !again) return;
      setupSaid = { clip, at: now };
      say([clip], SETUP_TEXT[clip], "next");
    };
    // ---- The spoken coach (api/session/talk): it answers what the patient says, greets them at the start, talks
    // after each set and gives a spoken summary at the end. The count and the form cues stay instant recordings.
    let talking = false;
    let notCountedCount = 0;
    let handsCount = 0;
    let askedAt = 0;                 // when the coach last asked a question: a one-word answer is enough for a while
    let answerPendingUntil = 0;      // the patient asked something: nothing else is said until the answer starts
    const pushLog = (row: LogRow) => setLog((l) => [...l.slice(-19), row]);
    /** The same as numbers: the server answers "am I doing it right?" from these, in the app's own words. */
    const formData = () => {
      const tally = new Map<string, number>();
      for (const r of repResults) if (r.fault) tally.set(CUE[r.fault], (tally.get(CUE[r.fault]) ?? 0) + 1);
      const top = [...tally].sort((a, b) => b[1] - a[1])[0];
      const last = repResults[repResults.length - 1];
      return {
        counted: repResults.length, good: repResults.filter((r) => !r.fault).length,
        top_fault: top?.[0] ?? null, top_fault_count: top?.[1] ?? 0,
        last_fault: last?.fault ? CUE[last.fault] : null,
        last_score: last && last.quality !== null ? Math.round(last.quality * 100) : null,
        hands: handsCount, small: notCountedCount,
      };
    };
    /** What the camera has seen so far, in words, so the coach can answer "am I doing it right?" truthfully. */
    const formFacts = (): string => {
      const good = repResults.filter((r) => !r.fault).length;
      const tally = new Map<string, number>();
      for (const r of repResults) if (r.fault) tally.set(CUE[r.fault], (tally.get(CUE[r.fault]) ?? 0) + 1);
      const last = repResults[repResults.length - 1];
      return [
        repResults.length ? `${good} of ${repResults.length} counted repetitions had good form.` : "No repetition counted yet.",
        tally.size ? `Mistakes the camera saw: ${[...tally].map(([k, v]) => `"${k}" ${v} ${v === 1 ? "time" : "times"}`).join(", ")}.` : "",
        last ? `The last repetition: ${last.fault ? `"${CUE[last.fault]}"` : "good form"}${last.quality !== null ? `, score ${Math.round(last.quality * 100)} out of 100` : ""}.` : "",
        handsCount ? `${handsCount} did not count because the hands pushed on the legs or chair.` : "",
        notCountedCount ? `${notCountedCount} did not count because the movement was too small.` : "",
      ].filter(Boolean).join(" ").slice(0, 500);
    };
    let lastCueText: string | null = null;
    let bestDegrees: number | null = null;
    const addTurn = (who: "you" | "coach", text: string) => setTurns((t) => [...t.slice(-5), { who, text }]);
    // A sentence said in two breaths arrives as two pieces. The second piece is joined to the first and the first
    // one's answer is thrown away (heardSeq), so the coach answers the whole thought once instead of cutting in.
    let heardSeq = 0;
    let pendingHeard: { text: string; at: number } | null = null;   // waiting for its answer to start
    let heardPieces = 1;                                            // how many heard pieces the last question was joined from
    let cutReplyAt = 0;                                              // when the patient last talked over an answer
    const stale = (event: string, my: number) => event === "heard" && my !== heardSeq;
    const talk = async (event: "heard" | "start" | "set_done" | "finished", heard?: string, previous?: number | null) => {
      if (talking && event !== "heard") return;      // a question always gets through; moments wait their turn
      talking = true;
      const my = event === "heard" ? ++heardSeq : heardSeq;
      if (event === "heard" && heard) pendingHeard = { text: heard, at: Date.now() };
      if (heard) addTurn("you", heard);
      try {
        const scores = repResults.map((r) => r.quality).filter((q): q is number => q !== null);
        const res = await fetch("/api/session/talk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: p.token, event, heard,
            context: {
              exercise_id: p.exerciseId, reps_done: repResults.length, target,
              set: Math.min(p.sets, Math.floor(repResults.length / p.reps) + (event === "set_done" ? 0 : 1)), sets: p.sets,
              last_cue: lastCueText, quality: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) : null,
              best_degrees: bestDegrees, previous_degrees: previous ?? null, not_counted: notCountedCount + handsCount,
              form: formFacts(),
              form_data: formData(),
            },
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          reply: string; action: "none" | "stop"; audio: string | null; tts: { text: string; exp: number; sig: string }[] | null;
        };
        if (stale(event, my)) return;                  // they carried on talking: the longer sentence gets the answer
        addTurn("coach", data.reply);
        rememberSaid(data.reply);
        if (/\?\s*$/.test(data.reply.trim())) askedAt = Date.now();
        const when = event === "heard" ? "now" : "queue";
        if (data.audio) {
          const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(data.audio), (ch) => ch.charCodeAt(0))], { type: "audio/mpeg" }));
          if (!playUrl(url, when)) say([], data.reply, when);
        } else if (data.tts) {
          // Our own voice (api/tts.py), one sentence at a time: the first plays while the next is being made.
          let first = true;
          // If the patient is still talking, the answer waits for them (their next piece replaces this answer), but
          // not for long: in a noisy room the microphone "hears" something all the time.
          for (let waited = 0; isHearing() && waited < 1200; waited += 100) await new Promise((r) => setTimeout(r, 100));
          for (const ticket of data.tts) {
            if (stale(event, my)) return;
            const spoken = await voiceFetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ticket) });
            if (stale(event, my)) return;
            if (first && event === "heard") pendingHeard = null;       // the answer starts now: no longer waiting
            const ok = spoken?.ok && spoken.headers.get("content-type")?.includes("audio");
            const url = ok ? URL.createObjectURL(await spoken!.blob()) : null;
            if (!url || !playUrl(url, first ? when : "queue")) say([], ticket.text, first ? when : "queue");
            first = false;
          }
        } else {
          say([], data.reply, when);
        }
        if (data.action === "stop") {
          // Pain or a red flag, said out loud: the server already told the physiotherapist.
          stop();
          finished = true;
          p.onPain(data.reply);
        }
      } catch {
        // no answer this time; the session carries on
      } finally {
        talking = false;
        if (event === "heard" && my === heardSeq) {
          answerPendingUntil = 0;
          pendingHeard = null;
        }
      }
    };

    // ---- Emergency: a possible fall, or "help" / "call 911" out loud. Counting stops, the screen asks
    // "Are you okay?" with buttons to call 911 or the emergency contact, the coach asks out loud, and the
    // physiotherapist gets an alert. Nothing calls anyone by itself: the patient answers or taps.
    const fallWatch = new FallWatch();
    let emergencyOn = false;
    let emergencyTimer = 0;
    const raiseEmergency = (reason: "fall" | "help", asked: Emergency["asked"] = "none") => {
      if (!emergencyOn) {
        emergencyOn = true;
        stopVoice();
        // One clear question, answered by voice ("no, I'm okay" / "yes, call 911") or with the buttons.
        if (reason === "fall") say(["fall_ask"], "Are you okay? It looks like you fell. Should I call 911?", "now");
        else say(["help_ask"], "I'm here. Are you okay? Should I call 911?", "now");
        fetch("/api/session/alert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: p.token, kind: reason, exercise: p.exerciseName }),
        }).catch(() => {});
        // No answer: ask again every 20 s, and say that the physiotherapist knows.
        const again = () => {
          if (!emergencyOn) return;
          say(["ask_again"], "I've let your physiotherapist know. Should I call 911? Say yes or no.", "now");
          emergencyTimer = window.setTimeout(again, 20000);
        };
        emergencyTimer = window.setTimeout(again, 20000);
      }
      if (asked === "911") say(["confirm_911"], "Tap the red button now to call 911. Your physiotherapist knows.", "now");
      if (asked === "contact") say(["tap_contact"], "Tap the button to call your emergency contact.", "now");
      setEmergency((e) => ({ reason: e?.reason ?? reason, asked: asked !== "none" ? asked : e?.asked ?? "none" }));
    };
    /** "No, I'm okay" (by voice or the button): close the question, say so warmly, and carry on. */
    const standDown = () => {
      if (!emergencyOn) return;
      emergencyOn = false;
      window.clearTimeout(emergencyTimer);
      setEmergency(null);
      counter.resetAfterTrackingGap();
      stableFrames = 0;
      fallWatch.reset();
      say(["decline_ok"], "Okay, I won't call anyone. Glad you're alright. I've let your physiotherapist know, just in case.", "now");
    };
    okayRef.current = standDown;
    // What the microphone hears. Ignored while the coach is talking, and the same command twice within 4 s counts once.
    let lastCommand = { what: "", at: 0 };
    let lastAsked = { text: "", at: 0 };
    onHeard((heard, when) => {
      if (finished || cancelled) return;
      // The browser's echo cancellation takes the coach's voice out of the microphone. Second guard: a sentence heard
      // while the coach was talking, made of the coach's own words, is dropped. So is what a cough turns into.
      if (spokeDuring(when.startMs, when.endMs) > 0.5 && isEcho(heard)) return;
      if (looksLikeNoise(heard, (when.endMs - when.startMs) / 1000)) return;
      setHeardLive(heard);
      // While "Are you okay? Should I call 911?" is open, any answer counts, even a single "no".
      if (emergencyOn) {
        const contact = matchCommand(heard, p.emergency?.name ?? null) === "call_contact";
        const answer = contact ? "contact" : emergencyAnswer(heard);
        if (answer === "no") standDown();
        else if (answer === "yes") raiseEmergency("help", "911");
        else if (answer === "contact") raiseEmergency("help", p.emergency ? "contact" : "911");
        return;
      }
      let command = matchCommand(heard, p.emergency?.name ?? null);
      // "Continue" only means something while paused; otherwise it is just something they said to the coach.
      if (command === "resume" && !userPaused) command = null;
      if (!command) {
        // Not a command: the coach answers it. After the Talk button one word is enough; otherwise two, so a stray
        // "okay" in the room does not start a conversation.
        const nowMs = Date.now();
        // The second piece of a sentence: its first piece still waits for an answer, or its answer was just talked over.
        // Two pieces at most, and only close together: joining piece after piece grew one endless sentence
        // ("sit down two degrees to go okay that didn't ... I can't", 20 November) that got answered again and again.
        let text = heard;
        let pieces = 1;
        if (heardPieces < 2 && pendingHeard && nowMs - pendingHeard.at < 4000) { text = `${pendingHeard.text} ${heard}`; pieces = 2; }
        else if (heardPieces < 2 && cutReplyAt > lastAsked.at && nowMs - lastAsked.at < 5000 && lastAsked.text) { text = `${lastAsked.text} ${heard}`; pieces = 2; }
        const words = text.split(/\s+/).filter(Boolean).length;
        // One word is enough right after the Talk button, or when the coach has just asked something ("Good.").
        const justAsked = nowMs - askedAt < 12000;
        const oneWordOk = pushing() || justAsked;
        if (emergencyOn || words < (oneWordOk ? 1 : 2)) return;
        // The room talks too (a friend, a video): only what is meant for the coach gets an answer.
        if (!meantForCoach(text, { justAsked, talkButton: pushing() })) return;
        if (text === lastAsked.text && nowMs - lastAsked.at < 5000) return;
        lastAsked = { text, at: nowMs };
        heardPieces = pieces;
        askedAt = 0;
        answerPendingUntil = performance.now() + 5000;
        stopVoice();                                                                   // the patient talks: the coach stops
        void talk("heard", text);
        return;
      }
      const now = performance.now();
      if (command === lastCommand.what && now - lastCommand.at < 4000) return;
      lastCommand = { what: command, at: now };
      if (command === "help") raiseEmergency("help");
      else if (command === "call_911") raiseEmergency("help", "911");
      else if (command === "call_contact") raiseEmergency("help", p.emergency ? "contact" : "911");
      else if (command === "okay") okayRef.current();
      else if (command === "pain") hurtsRef.current();
      else if (command === "pause") void setPause(true);
      else if (command === "resume") void setPause(false);
    });
    // Barge-in: when the patient has been talking for half a second, the coach stops talking.
    let hearingSince = 0;
    let transcribing = false;
    const unwatchListening = watchListening((st) => {
      setListen(st);
      if (st.hearing && !hearingSince) hearingSince = performance.now();
      if (!st.hearing) hearingSince = 0;
      transcribing = st.working;
    });
    // The coach does not count or cue out loud while the patient is speaking (after a quarter of a second, so a
    // click does not mute it; for at most 7 s, so a noisy room does not silence it), while their words are being
    // turned into text, or while their question waits for its answer. The screen still shows everything.
    holdSpeech = () => {
      const now = performance.now();
      if (answerPendingUntil > now) return "answer";
      if (hearingSince && now - hearingSince > 250 && now - hearingSince < 4000) return "talking";
      return transcribing ? "talking" : null;
    };
    const bargeIn = window.setInterval(() => {
      const now = performance.now();
      // The patient talks over the coach's answer: the coach stops. The count and the cues (a second or two) are
      // finished instead: in a room with other voices they were cut off again and again, and nothing was heard.
      if (hearingSince && now - hearingSince > 500 && voiceBusy() && now > cueUntil) {
        stopVoice();
        cutReplyAt = Date.now();
      }
      // A count that waited: said when the patient has stopped talking, or after 1.2 s if the room just is noisy.
      // One that waited for an answer for over three seconds is old news and is left out.
      if (held) {
        const why = holdSpeech();
        const waited = now - held.at;
        if (!why || (why === "talking" && waited > 1200)) {
          const h = held;
          held = null;
          if (waited < 3000) {
            const hold = holdSpeech;
            holdSpeech = () => null;
            say(h.clips, h.text, h.when);
            holdSpeech = hold;
          }
        }
      }
    }, 100);
    setCoachSpeaking(voiceBusy);
    if (process.env.NODE_ENV !== "production") {
      // Development only: window.__motivaSay("/test/q1.wav") plays a sound file into the listener as if spoken.
      (window as unknown as { __motivaSay?: (url: string) => Promise<void> }).__motivaSay = feedAudioForTest;
      // window.__motivaMic("/test/q1.wav") uses the file as the microphone, through the real capture path.
      Object.assign(window, { __motivaMic: fakeMicrophoneForTest, __motivaCapture: captureMode });
    }

    // A patient who stands ready but does not start hears "Whenever you're ready" now and then (at most 3 times).
    let lastProgressAt = 0;
    let idleNudges = 0;
    const showBanner = (next: { text: string; tone: LiveTone } | null) => {
      const key = next ? `${next.tone}:${next.text}` : "";
      if (key === lastBanner) return;
      lastBanner = key;
      setBanner(next);
    };

    const showSetupIssue = (next: string | null) => {
      if (next === lastSetupIssue) return;
      lastSetupIssue = next ?? "";
      setSetupIssue(next);
    };

    const stop = () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      video.pause();
      landmarker?.close();
      landmarker = null;
    };
    stopRef.current = stop;

    // ---- Pause: the camera goes off (really off: the light too), nothing is counted and nobody is asked whether
    // they fell. The microphone stays on, so "continue" brings it back, and the coach still answers questions.
    let userPaused = false;
    const setPause = async (on: boolean) => {
      if (finished || cancelled || emergencyOn || on === userPaused) return;
      userPaused = on;
      setPausedUi(on);
      fallWatch.reset();
      if (on) {
        stopVoice();
        if (p.source) video.pause();
        else {
          stream?.getTracks().forEach((t) => t.stop());
          stream = null;
          video.srcObject = null;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        say(["paused"], "Paused. The camera is off. Say continue, or tap Resume, when you're back.", "now");
        return;
      }
      try {
        if (p.source) await video.play();
        else {
          const again = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(isPhoneDevice(navigator.userAgent)), audio: false })
            .catch(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false }));
          if (cancelled || finished || userPaused) return again.getTracks().forEach((t) => t.stop());
          stream = again;
          video.srcObject = again;
          await video.play();
        }
        stableFrames = 0;
        needsCounterReset = true;
        lastGoodT = -Infinity;
        lastProgressAt = performance.now();
        say(["resumed"], "Welcome back. Carry on when you're ready.", "now");
      } catch {
        userPaused = true;
        setPausedUi(true);
        setError("The camera could not restart. Allow the camera for this page, then tap Resume.");
      }
    };
    pauseRef.current = (on) => { setError(null); void setPause(on); };

    // Phones and browsers pause video when the page goes to the background (another app, another tab).
    // Then the session waits, and carries on when the patient comes back, instead of failing.
    const play = async () => {
      try {
        await video.play();
        if (!finished && !cancelled) setStatus("running");
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") setStatus("paused");
        else throw e;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && !finished && !cancelled && !userPaused && video.paused && !video.ended) play().catch(() => {});
      if (document.visibilityState === "hidden" && !finished) setStatus("paused");
    };
    document.addEventListener("visibilitychange", onVisible);

    const finish = async (reason: "target" | "ended") => {
      if (finished) return;
      finished = true;
      stop();
      if (repResults.length === 0) return p.onDone(null);
      setStatus("saving");
      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: p.token, exercise_id: p.exerciseId, source: "camera",
            started_at: started.toISOString(), ended_at: new Date().toISOString(), reps: repResults,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `status ${res.status}`);
        void talk("finished", undefined, data.previous_knee_bend ?? null);   // keeps speaking after this screen closes
        p.onDone(data);
      } catch (e) {
        setStatus("error");
        setError(`Could not save the session (${e instanceof Error ? e.message : "network error"}). Your reps: ${repResults.length}.`);
      }
    };
    finishRef.current = finish;

    // What is drawn over the video: the tracked skeleton, the measured joint with its angle, and any live mistake.
    type Overlay = { tone: LiveTone; kneesIn: boolean; elbowBent: boolean; focus: [number, number, number] | null; label: string | null };
    const SKY = "#4aa8ff", GOOD = "#34d399", WARN = "#ff5a52", AMBER = "#ffb020";
    let fontFamily = "";
    const draw = (points: { x: number; y: number }[] | undefined, connections: { start: number; end: number }[], o: Overlay | null) => {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!points) return;
      const w = canvas.width, h = canvas.height;
      const base = Math.min(w, h);
      const X = (i: number) => points[i].x * w, Y = (i: number) => points[i].y * h;
      const lw = Math.max(4, base / 130);

      // bones: sky blue while tracking, green once the goal is reached, faint during the camera check
      ctx.lineCap = "round";
      ctx.lineWidth = lw;
      ctx.strokeStyle = !o ? "rgba(255, 255, 255, 0.6)" : o.tone === "good" ? GOOD : SKY;
      ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
      ctx.shadowBlur = lw;
      for (const c of connections) {
        if (c.start < 11 || c.end < 11) continue; // skip the face
        ctx.beginPath();
        ctx.moveTo(X(c.start), Y(c.start));
        ctx.lineTo(X(c.end), Y(c.end));
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // the measured joint: a filled wedge between the two bones, like a goniometer
      if (o?.focus) {
        const [a, v, c] = o.focus;
        const a1 = Math.atan2(Y(a) - Y(v), X(a) - X(v));
        let d = Math.atan2(Y(c) - Y(v), X(c) - X(v)) - a1;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        const R = base * 0.085;
        ctx.beginPath();
        ctx.moveTo(X(v), Y(v));
        ctx.arc(X(v), Y(v), R, a1, a1 + d, d < 0);
        ctx.closePath();
        ctx.fillStyle = "rgba(255, 176, 32, 0.3)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(X(v), Y(v), R, a1, a1 + d, d < 0);
        ctx.strokeStyle = AMBER;
        ctx.lineWidth = lw * 1.1;
        ctx.stroke();
        if (o.label) {
          // The stage is mirrored like a mirror; text is flipped back so it reads normally.
          const mid = a1 + d / 2 + Math.PI; // outside the joint, away from the wedge
          const size = Math.round(base * 0.058);
          fontFamily ||= getComputedStyle(canvas).fontFamily || "sans-serif";
          ctx.save();
          ctx.translate(X(v) + Math.cos(mid) * R * 1.5, Y(v) + Math.sin(mid) * R * 1.5);
          if (mirrored) ctx.scale(-1, 1);
          ctx.font = `600 ${size}px ${fontFamily}`;
          const tw = ctx.measureText(o.label).width, padX = size * 0.4, bh = size * 1.45;
          ctx.fillStyle = "rgba(6, 9, 20, 0.82)";
          ctx.beginPath();
          ctx.roundRect(-tw / 2 - padX, -bh / 2, tw + 2 * padX, bh, bh / 2);
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(o.label, 0, size * 0.04);
          ctx.restore();
        }
      }

      // joints: white dots; the measured joint amber; a joint that is going wrong red
      const r = Math.max(5, base / 110);
      for (let i = 11; i < points.length; i++) {
        if (i > 16 && i < 23) continue; // fingers
        const bad = (o?.kneesIn && (i === 25 || i === 26)) || (o?.elbowBent && (i === 13 || i === 14));
        const focus = o?.focus?.[1] === i;
        ctx.beginPath();
        ctx.arc(X(i), Y(i), bad || focus ? r * 1.7 : r, 0, Math.PI * 2);
        ctx.fillStyle = bad ? WARN : focus ? AMBER : "#ffffff";
        ctx.fill();
        ctx.lineWidth = Math.max(2, lw * 0.35);
        ctx.strokeStyle = bad || focus ? "#ffffff" : "rgba(6, 9, 20, 0.55)";
        ctx.stroke();
      }
    };

    (async () => {
      try {
        const [loaded, vision] = await Promise.all([loadModel(p.modelKey), import("@mediapipe/tasks-vision")]);
        if (cancelled) return;
        const model = loaded?.model ?? null;
        setModelNote(describeModel(loaded, p.modelKey));
        const fileset = await vision.FilesetResolver.forVisionTasks("/mediapipe");
        const modelAssetPath = `/models/pose_landmarker_${model?.pose_model ?? "full"}.task`;
        const make = (delegate: "GPU" | "CPU") =>
          vision.PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath, delegate }, runningMode: "VIDEO", numPoses: 1,
          });
        type Tracker = Awaited<ReturnType<typeof make>>;
        let delegate: "GPU" | "CPU" = "GPU";
        let pose: Tracker = await make("GPU").catch(() => { delegate = "CPU"; return make("CPU"); });
        landmarker = pose;
        // Some phone and tablet browsers create the GPU tracker without an error and then never find a body in the
        // camera picture. When nobody has been found for a while, a CPU tracker looks at the same frame once; if it
        // finds a person, the session switches to it for good. (No person in view: both find nothing, nothing changes.)
        let missingSince = -1;
        let probes = 0;
        let probing = false;
        const probeCpu = async (ts: number) => {
          probing = true;
          probes++;
          try {
            const cpu = await make("CPU");
            const found = (cpu.detectForVideo(video, ts + 1) as { worldLandmarks?: unknown[] }).worldLandmarks?.length;
            if (found && !cancelled && !finished) {
              pose.close();
              pose = cpu;
              landmarker = cpu;
              delegate = "CPU";
              lastTs = ts + 1;
            } else {
              cpu.close();
            }
          } catch {
            // the CPU tracker could not start: keep the GPU one
          } finally {
            probing = false;
            missingSince = -1;
          }
        };
        const connections = vision.PoseLandmarker.POSE_CONNECTIONS;

        if (p.source) {
          video.src = p.source;
          video.muted = true;
        } else {
          const preferred = cameraConstraints(isPhoneDevice(navigator.userAgent));
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: preferred, audio: false });
          } catch (e) {
            // Older iPhones occasionally reject a detailed constraint set even though the
            // front camera itself works. Retry the minimum safe request instead of failing.
            if (!(e instanceof DOMException) || e.name !== "OverconstrainedError") throw e;
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
          }
          video.srcObject = stream;
        }
        /** Everything that happens for one video frame. t = seconds on the session clock, ts = tracker timestamp (ms). */
        const processFrame = (t: number, ts: number) => {
          frameClock.push(performance.now() / 1000);
          if (frameClock.length > 20) frameClock.shift();
          const nowFps = fpsOf(frameClock);
          if (nowFps && nowFps !== lastFps) { lastFps = nowFps; setFps(nowFps); }
          if (probing || userPaused) return;
          const result = pose.detectForVideo(video, ts) as {
            landmarks?: { x: number; y: number }[][];
            worldLandmarks?: { x: number; y: number; z: number }[][];
          };
          const world = result.worldLandmarks?.[0];
          // During a set, a short loss of the body (a moment hidden by the chair) is skipped, not a restart.
          const inSet = startSpoken && t - lastGoodT < SHORT_GAP_SECONDS;
          if (!world) {
            if (fallWatch.missing(t)) raiseEmergency("fall");
            if (emergencyOn) { draw(undefined, connections, null); return; }
            if (inSet) { draw(undefined, connections, null); return; }
            coachSetup("setup_find_you");
            if (missingSince < 0) missingSince = performance.now();
            if (delegate === "GPU" && probes < 3 && performance.now() - missingSince > 4000) void probeCpu(ts);
            draw(undefined, connections, null);
            stableFrames = 0;
            needsCounterReset = true;
            showSetupIssue("Step into view so the camera can find you.");
            return;
          }
          missingSince = -1;
          const screen = result.landmarks?.[0];
          // A possible fall is checked before the camera check: someone on the floor is rarely fully in the picture.
          const hipY = screen && screen.length > 24 ? (screen[23].y + screen[24].y) / 2 : null;
          // Two things tell a fall from walking up to the laptop or bowing to reach it: is the body growing in the
          // picture (coming closer), and are the hips still well above the feet (or the knees, when the feet are cut off)?
          const seenAt = (i: number) => ((screen?.[i] as { visibility?: number } | undefined)?.visibility ?? 1) > 0.5;
          const torso = screen && screen.length > 24
            ? Math.hypot((screen[11].x + screen[12].x - screen[23].x - screen[24].x) / 2, (screen[11].y + screen[12].y - screen[23].y - screen[24].y) / 2) : null;
          const hipWorldY = (world[23].y + world[24].y) / 2;
          const hipsAboveFeet = seenAt(27) || seenAt(28) ? (world[27].y + world[28].y) / 2 - hipWorldY
            : seenAt(25) || seenAt(26) ? ((world[25].y + world[26].y) / 2 - hipWorldY) * 2 : null;
          // The main evidence: how far head, shoulders and hips are below where they are when standing (lib/pose/fall.ts).
          const picture = fallPicture(screen, video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1);
          if (fallWatch.seen(t, trunkLean(world.map((l) => [l.x, l.y, l.z] as Vec)), hipY, { torso, hipsAboveFeet, picture })) raiseEmergency("fall");
          if (process.env.NODE_ENV !== "production") (window as unknown as { __jhealthFall?: unknown }).__jhealthFall = { t, picture, ...fallWatch.debug };
          if (emergencyOn) { draw(screen, connections, null); return; }
          // Strict before the set starts (to be sure the framing is right), lenient once it is under way.
          const issue = poseSetupIssue(p.exerciseId, screen, startSpoken ? DURING_SET : {});
          if (issue && inSet) { draw(screen, connections, null); return; }
          if (issue) {
            coachSetup(p.exerciseId === "arm_raise" ? "setup_step_back_arm" : "setup_step_back");
            draw(screen, connections, null);
            stableFrames = 0;
            needsCounterReset = true;
            showSetupIssue(issue);
            return;
          }
          // Require about half a second of a stable, complete body before collecting a
          // rep. It prevents entering the frame or putting the phone down from becoming
          // a false repetition on either an iPhone or a laptop webcam.
          stableFrames++;
          if (stableFrames <= 8) {
            coachSetup("setup_hold");
            draw(screen, connections, null);
            showSetupIssue("Hold still for a moment — camera check in progress.");
            return;
          }
          if (needsCounterReset) {
            counter.resetAfterTrackingGap();
            needsCounterReset = false;
          }
          lastGoodT = t;
          showSetupIssue(null);
          if (!startSpoken) {
            startSpoken = true;
            lastProgressAt = performance.now();
            const own = `start_${p.exerciseId}`;
            say([voiceReady([own]) ? own : "start"], `Camera's ready. We'll do ${p.exerciseName}: ${target} repetitions. Take your time.`);
            void talk("start");
          }
          const frame: Frame = world.map((l) => [l.x, l.y, l.z] as Vec);
          const signal = profile.repSignal(frame);
          const kneesIn = profile.liveWarning?.(frame, counter.isDown) ?? false;
          frames.push(frame);
          kneesInFlags.push(kneesIn);
          const ankleY = Math.max(seenAt(27) && screen ? screen[27].y : -1, seenAt(28) && screen ? screen[28].y : -1);
          screenTrack.push({ hip: hipY ?? NaN, leg: ankleY > 0 && hipY !== null ? ankleY - hipY : NaN, torso: torso ?? NaN });
          kneesInRun = kneesIn ? kneesInRun + 1 : 0;
          const value = Math.round(profile.liveValue(frame));
          setBend(value);

          // Live coaching: count down to the goal, say when it is reached, and show a mistake the moment it happens.
          const elbowBent = p.exerciseId === "arm_raise" && counter.isDown && bentElbowNow(frame);
          elbowRun = elbowBent ? elbowRun + 1 : 0;
          const warning = kneesInRun >= 4 ? CUE.knees_in : elbowRun >= 5 ? CUE.bent_elbow : null;
          let state: LiveState | null = null;
          if (goal) {
            if (value >= goal.goal) reachedThisRep = true;
            state = liveCoach(goal, value, { moving: counter.isDown, reached: reachedThisRep, warning });
            setLive(state);
            // A finished repetition's verdict stays up for a moment, unless something is going wrong right now.
            showBanner(repCue && performance.now() < repCueUntil && state.tone !== "warn" ? repCue : { text: state.message, tone: state.tone });
          }
          const vis = (i: number) => (screen?.[i] as { visibility?: number } | undefined)?.visibility ?? 1;
          draw(screen, connections, {
            tone: state?.tone ?? "move", kneesIn: kneesInRun >= 4, elbowBent: elbowRun >= 5,
            focus: goal && screen ? goal.joint[focusSide(p.exerciseId, frame, vis)] : null,
            label: `${value}°`,
          });

          // Say it at the moment it happens: a live warning (knees caving) for about half a second, once per repetition.
          const liveCue = profile.liveWarningFault ? CUE[profile.liveWarningFault] : null;
          if (kneesInRun === 8 && liveCue) {
            if (!cueSpokenThisRep && performance.now() - lastSpokenCue > 4000) {
              say([profile.liveWarningFault as string], liveCue, "now");
              cueSpokenThisRep = true;
              lastSpokenCue = performance.now();
            }
          }

          const rep = counter.push(t, signal);
          if (counter.isDown) lastProgressAt = performance.now();
          else if (!rep && lastProgressAt && performance.now() - lastProgressAt > 30000 && idleNudges < 1) {
            idleNudges++;
            lastProgressAt = performance.now();
            say(["idle"], "Whenever you're ready.");
          }
          if (process.env.NODE_ENV !== "production") {
            // Development only: lets tests and the browser console see what the tracker is doing.
            (window as unknown as { __jhealth?: object }).__jhealth = {
              frames: frames.length, videoTime: t, signal: Math.round(signal), lowest: Math.round(Math.min(...counter.knee)),
              highest: Math.round(Math.max(...counter.knee)), reps: repResults.length,
            };
          }
          if (!rep) return;
          // How far the hips came down in the picture: counts a deep movement whose angle the camera read too small.
          const drop = hipDropShare(screenTrack.slice(rep.startIndex, rep.endIndex + 1));
          if (!countsAsRep(profile, rep, drop)) {
            if (process.env.NODE_ENV !== "production") {
              const w = window as unknown as { __jhealthReps?: object[] };
              (w.__jhealthReps ??= []).push({ measure: Math.round(profile.repMeasure(rep)), drop: drop === null ? null : Number(drop.toFixed(2)), fault: barelyMoved(profile, rep, drop) ? "ignored" : "too_small" });
            }
            // A step or a shift of weight is not an attempt: nothing is said about it.
            if (barelyMoved(profile, rep, drop)) return;
            // Too small to be a repetition: say so and why, and do not count it.
            lastProgressAt = performance.now();
            reachedThisRep = false;
            cueSpokenThisRep = false;
            repCue = { text: profile.notCounted, tone: "warn" };
            repCueUntil = performance.now() + 3000;
            showBanner(repCue);
            say([`not_counted_${p.exerciseId}`], profile.notCounted, "next");
            notCountedCount++;
            pushLog({ n: null, score: null, text: "Didn't count: too small a movement", tone: "bad", fault: null, small: true });
            return;
          }
          const slice = frames.slice(rep.startIndex, rep.endIndex + 1);
          const flags = kneesInFlags.slice(rep.startIndex, rep.endIndex + 1);
          let quality: number | null = null;
          if (model) {
            try {
              quality = 1 - mistakeProbability(model, repFeatures(slice, rep.endTime - rep.startTime, model));
            } catch {
              quality = null;
            }
          }
          // The rules name what they see; if they see nothing but the model is confident (about 9 in 10 such flags
          // are real, ml/operating_point.py), a gentle general cue instead.
          const fault = withModelFlag(
            profile.fault({ rep, frames: slice, times: counter.times.slice(rep.startIndex, rep.endIndex + 1), liveFlags: flags, drop }),
            quality === null ? null : 1 - quality, model?.flag_threshold,
          );
          if (!model) quality = ruleQuality(fault);
          if (process.env.NODE_ENV !== "production") {
            // Development only: every finished movement with the numbers the rules judged it on.
            const w = window as unknown as { __jhealthReps?: object[] };
            (w.__jhealthReps ??= []).push({
              measure: Math.round(profile.repMeasure(rep)), drop: drop === null ? null : Number(drop.toFixed(2)), fault,
              hands: profile.handsShare ? Number(profile.handsShare({ rep, frames: slice, times: counter.times.slice(rep.startIndex, rep.endIndex + 1), liveFlags: flags }).toFixed(2)) : null,
              seconds: Number(rep.activeSeconds.toFixed(1)),
            });
          }
          if (fault && NOT_COUNTED_FAULTS.includes(fault) && p.exerciseId === "sit_to_stand") {
            // Standing up from a chair pushed with the hands: the legs did not do the work, so it is named, shown, and
            // not counted. (In a squat the hands hang beside the legs anyway: there it is a cue, and the squat counts.)
            lastProgressAt = performance.now();
            reachedThisRep = false;
            cueSpokenThisRep = false;
            repCue = { text: HANDS_NOT_COUNTED, tone: "warn" };
            repCueUntil = performance.now() + 3500;
            showBanner(repCue);
            say(["not_counted_hands"], HANDS_NOT_COUNTED, "next");
            handsCount++;
            lastCueText = CUE[fault];
            pushLog({ n: null, score: null, text: "Didn't count: hands pushed", tone: "bad", fault, small: false });
            return;
          }
          const measure = Math.round(profile.repMeasure(rep));
          const r: RepResult = {
            quality, fault,
            knee_bend_deg: profile.measureColumn === "knee_bend_deg" ? measure : null,
            rom_deg: profile.measureColumn === "rom_deg" ? measure : null,
            duration_s: Number(rep.activeSeconds.toFixed(2)),
          };
          repResults.push(r);
          setResults([...repResults]);
          pushLog({ n: repResults.length, score: quality === null ? null : Math.round(quality * 100), text: fault ? CUE[fault] : "Good form", tone: fault ? "warn" : "good", fault, small: false });
          repCue = fault ? { text: CUE[fault], tone: "warn" } : { text: quality === null ? "Good rep" : `Good rep, ${Math.round(quality * 100)} out of 100`, tone: "good" };
          repCueUntil = performance.now() + 2500;
          showBanner(repCue);
          reachedThisRep = false;
          cueSpokenThisRep = false;

          const n = repResults.length;
          lastProgressAt = performance.now();
          idleNudges = 0;
          // The live warning was already said during the repetition; do not repeat it after the count.
          const named = fault && fault !== profile.liveWarningFault ? fault : null;
          const allDone = n >= target;
          const setDone = !allDone && n % p.reps === 0;
          const spoken = repSpokenText(n, named, named ? CUE[named] : null);
          // The count, the cue if there is one, then where we are in the set or a word of encouragement: every
          // repetition is answered out loud, because the screen is too far away to read.
          const clips = repClips(n, named, { allDone, setDone, leftInSet: p.reps - (((n - 1) % p.reps) + 1), halfway: target >= 8 && n * 2 === target });
          say(
            clips,
            allDone ? `${spoken} Nice work. That's all of them.`
              : setDone ? `${spoken} Set ${n / p.reps} is done. Take a breather, then continue.` : `${spoken} Keep going.`,
            "next",       // a warning still being spoken finishes its sentence before the count
          );
          bestDegrees = Math.max(bestDegrees ?? 0, Math.round(profile.repMeasure(rep)));
          if (named) lastCueText = CUE[named];
          if (setDone) void talk("set_done");
          if (n >= target) return finish("target");
        };

        if (p.source && p.step) {
          // Deterministic test mode: seek through the file at 15 frames per video second, whatever the browser's speed.
          await new Promise((r) => (video.readyState >= 1 ? r(null) : video.addEventListener("loadedmetadata", r, { once: true })));
          setStatus("running");
          playingSince = performance.now();
          for (let t = 0; t < video.duration && !cancelled && !finished; t += 1 / 15) {
            video.currentTime = t;
            await new Promise((r) => video.addEventListener("seeked", r, { once: true }));
            if (cancelled || finished) break;
            processFrame(t, Math.round(t * 1000) + 1);
          }
          if (!cancelled && !emergencyOn) finish("ended");     // an open "Are you okay?" waits for its answer
          return;
        }

        await play();
        playingSince = performance.now();
        if (cancelled) return stop();
        if (p.source) video.onended = () => finish("ended");

        const loop = () => {
          if (cancelled || finished || !landmarker) return;
          raf = requestAnimationFrame(loop);
          if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
          const clock = performance.now();
          if (clock - lastAnalysisTs < ANALYSIS_INTERVAL_MS - 1) return;
          lastVideoTime = video.currentTime;
          const ts = Math.max(lastTs + 1, Math.round(clock));
          lastTs = ts;
          lastAnalysisTs = ts;
          processFrame(p.source ? video.currentTime : ts / 1000, ts);
        };
        raf = requestAnimationFrame(loop);
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        const name = e instanceof DOMException ? e.name : "";
        setError(
          name === "NotAllowedError"
            ? "The camera was blocked. Allow camera access for this page, then try again."
            : name === "NotFoundError"
              ? "No camera found on this device."
              : `The session could not start (${e instanceof Error ? e.message : "unknown error"}).`,
        );
      }
    })();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      stop();
      if (!finished && !lastWordsRef.current) {
        stopVoice();
        window.speechSynthesis?.cancel();
      }
      window.clearTimeout(emergencyTimer);
      window.clearInterval(keepWarm);
      window.clearInterval(voicePathTimer);
      window.clearTimeout(helperTimer);
      window.clearInterval(bargeIn);
      onHeard(null);
      stopListening();
      unwatchListening();
      holdSpeech = () => null;
      held = null;
    };
    // The session runs once per mount; its inputs do not change while it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = results.length;
  const scores = results.map((r) => r.quality).filter((q): q is number => q !== null);
  const avg = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) : null;

  const hurts = async () => {
    stopRef.current();
    stopVoice();
    window.speechSynthesis?.cancel();
    // Said out loud, not only shown: the patient may be two metres from the screen.
    lastWordsRef.current = true;
    say(["pain_stop"], "Let's stop here. I've told your physiotherapist.", "now");
    const res = await fetch("/api/session/pain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: p.token, exercise: p.exerciseName }),
    }).catch(() => null);
    const data = res && res.ok ? await res.json() : null;
    p.onPain(data?.message ?? "Please stop exercising. If the pain is severe or comes with chest pain or trouble breathing, call 911.");
  };
  hurtsRef.current = hurts;

  return (
    <section className="call" aria-label={`${p.exerciseName} camera session`}>
      <div className={`stage${p.source ? "" : " mirrored"}`}>
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        {status === "loading" && (
          <div className="stage-loading">
            <span className="spinner" aria-hidden />
            <p>Getting the camera ready<small>Stand about 2 m back, so I can see you from shoulders to knees.</small></p>
          </div>
        )}
        {pausedUi && (
          <div className="stage-loading paused" role="status">
            <p>Paused<small>The camera is off. Tap Resume, or say &ldquo;continue&rdquo;.</small></p>
            <button type="button" className="btn primary" onClick={() => pauseRef.current(false)}><Icon name="play" /> Resume</button>
          </div>
        )}
        {status === "running" && setupIssue && !pausedUi && (
          <div className="stage-loading setup-check" role="status">
            <p>Camera check<small>{setupIssue}</small></p>
          </div>
        )}
        <div className="hud top">
          <span className="live"><i /> {pausedUi ? "Paused · camera off" : status === "running" ? `33 body points${fps ? ` · ${fps} fps` : ""}${listening ? " · listening" : ""}` : status === "loading" ? "Starting camera…" : status === "paused" ? "Paused: come back to this page to continue" : status === "saving" ? "Saving…" : "Stopped"}</span>
          <span className="count" aria-live="polite">{done}<small> / {target}</small></span>
        </div>
        {status === "running" && !setupIssue && !pausedUi && banner && <div className={`cue ${banner.tone}`} role="status">{banner.text}</div>}
        {status === "running" && !setupIssue && !pausedUi && live && (
          <div className={`gauge ${live.tone}`} aria-hidden>
            <span>{profileFor(p.exerciseId).liveLabel}</span>
            <div className="gauge-track">
              <i style={{ height: `${Math.min(100, (live.value / (live.goal * 1.3)) * 100)}%` }} />
              <b style={{ bottom: `${(1 / 1.3) * 100}%` }}><em>Goal {live.goal}°</em></b>
            </div>
            <strong>{live.value}°</strong>
          </div>
        )}
        <div className="hud bottom">
          <span className="readout-live">{p.exerciseName} · set {Math.min(p.sets, Math.floor(done / p.reps) + 1)} of {p.sets}</span>
          {bend !== null && <span className="readout-live"><small>{profileFor(p.exerciseId).liveLabel}</small> <b>{bend}°</b></span>}
          {avg !== null && <span className="readout-live"><small>Quality</small> <b>{avg}/100</b></span>}
          {(modelNote || voicePath) && <span className="model-note">{[modelNote, voicePath].filter(Boolean).join(" · ")}</span>}
        </div>
      </div>
      <div className="set-progress" aria-hidden>
        <div className="label">
          <span>Set {Math.min(p.sets, Math.floor(done / p.reps) + 1)} of {p.sets}</span>
          <span><b>{done}</b> of {target} repetitions</span>
        </div>
        <div className="bar"><i style={{ width: `${Math.min(100, (done / target) * 100)}%` }} /></div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <FormCheck exerciseId={p.exerciseId} log={log} />
      <div className="call-buttons">
        <button className="btn end" onClick={() => finishRef.current("ended")} disabled={status === "saving"}><Icon name="stop" /> End session</button>
        <button className="btn hurt" onClick={hurts}><Icon name="hand" /> It hurts</button>
      </div>
      {turns.length > 0 && (
        <div className="talk" aria-live="polite" aria-label="Conversation with the coach">
          {turns.slice(-4).map((t, i) => (
            <p key={i} className={t.who}><b>{t.who === "you" ? "You" : "Coach"}</b> {t.text}</p>
          ))}
        </div>
      )}
      <div className="talk-bar">
        <button
          type="button"
          className={`btn talk-btn${listen.pushing ? " on" : ""}`}
          onClick={() => { stopVoice(); talkNow(); }}
          aria-label="Talk to the coach"
        >
          <Icon name="chat" /> {listen.pushing ? "Listening… say it now" : "Talk to the coach"}
        </button>
        <button type="button" className="btn pause-btn" onClick={() => pauseRef.current(!pausedUi)} disabled={status !== "running" && !pausedUi}>
          <Icon name={pausedUi ? "play" : "pause"} /> {pausedUi ? "Resume" : "Pause"}
        </button>
        <p className={`heard${listen.hearing ? " hearing" : ""}`} aria-live="polite">
          {listen.error ? <span className="mic-error">{listen.error}</span>
            : listen.hearing ? <><i className="mic-dot" aria-hidden /> I&apos;m listening…</>
              : listen.working ? "Got it, one moment…"
                : heardLive ? <>You said: <b>{heardLive}</b></>
                  : listening ? "The microphone is on. Just talk: ask anything, or say how you feel." : "Tap the button and speak."}
        </p>
      </div>
      <p className="voice-hint faint small">
        {listening
          ? <>Talk to the coach any time: ask &ldquo;am I doing it right?&rdquo;, say how it feels, or say <b>&ldquo;pause&rdquo;</b> to step away. <b>&ldquo;Help&rdquo;</b>, <b>&ldquo;call 911&rdquo;</b>{p.emergency ? <>, <b>&ldquo;call {p.emergency.name}&rdquo;</b></> : null} and <b>&ldquo;it hurts&rdquo;</b> work too. What you say is turned into text on our server and not kept; the video stays on this device.</>
          : <>If you fall, the camera asks if you are okay and offers to call for help.</>}
      </p>
      {emergency && (
        <div className="emergency" role="alertdialog" aria-labelledby="emergency-title" aria-describedby="emergency-sub">
          <div className="emergency-card">
            <h2 id="emergency-title">Are you okay?</h2>
            <p id="emergency-sub">
              {emergency.reason === "fall" ? "It looks like you fell." : "You asked for help."} <b>Should I call 911?</b>
            </p>
            <button className="btn ok" onClick={() => okayRef.current()}>No, I&apos;m okay</button>
            <a className={`btn call-911${emergency.asked === "911" ? " asked" : ""}`} href="tel:911">Yes, call 911</a>
            {p.emergency && (
              <a className={`btn call-contact${emergency.asked === "contact" ? " asked" : ""}`} href={`tel:${p.emergency.phone}`}>
                Call {p.emergency.name}
              </a>
            )}
            <p className="faint small">Just answer out loud: &ldquo;No, I&apos;m okay&rdquo; or &ldquo;Yes, call 911&rdquo;{p.emergency ? <>, or &ldquo;call {p.emergency.name}&rdquo;</> : null}. Your physiotherapist has been told.</p>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * What the camera judged on the last movement, as a checklist (green passed, red failed), and the last few movements
 * in words: every repetition gets a comment, and a movement that did not count says why.
 */
function FormCheck({ exerciseId, log }: { exerciseId: string; log: LogRow[] }) {
  const checks = CHECKS[exerciseId] ?? CHECKS.squat;
  const last = log[log.length - 1];
  return (
    <div className="form-check" aria-live="polite">
      <p className="form-title">
        Form check
        <small>{last ? (last.n ? `repetition ${last.n}` : "last try, not counted") : "the camera checks these on every repetition"}</small>
      </p>
      <ul className="checks">
        {checks.map((c, i) => {
          const failed = !!last && ((last.small && i === 0) || (last.fault !== null && c.fails.includes(last.fault)));
          return <li key={c.label} className={!last ? "idle" : failed ? "fail" : "pass"}><i aria-hidden>{!last ? "" : failed ? "✕" : "✓"}</i>{c.label}</li>;
        })}
      </ul>
      {log.length > 0 && (
        <ol className="rep-log">
          {log.slice(-3).reverse().map((r, i) => (
            <li key={`${log.length}-${i}`} className={r.tone}>
              <b>{r.n ? `Rep ${r.n}` : "No count"}</b>
              <span>{r.text}</span>
              {r.score !== null && <em>{r.score}<small>/100</small></em>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
