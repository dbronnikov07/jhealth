"use client";
// The live camera session. Everything runs on the patient's device: the video never leaves it.
// Per frame:      pose tracker (MediaPipe) -> the exercise's rep signal -> rep counter, skeleton, live warning
// Per repetition: the exported model scores it (features.ts + model.ts), the rules name any mistake (exercises.ts)
// At the end:     only the numbers are sent to /api/session.
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { CUE, profileFor, ruleQuality, trunkLean, withModelFlag, type Fault } from "@/lib/pose/exercises";
import { repFeatures, type Frame, type Vec } from "@/lib/pose/features";
import { ANALYSIS_INTERVAL_MS, cameraConstraints, isPhoneDevice, poseSetupIssue } from "@/lib/pose/camera";
import { bentElbowNow, focusSide, fpsOf, LIVE_GOALS, liveCoach, type LiveState, type LiveTone } from "@/lib/pose/live";
import { describeModel, loadModel } from "@/lib/pose/loader";
import { mistakeProbability } from "@/lib/pose/model";
import { RepCounter } from "@/lib/pose/reps";
import { coachVoice, repSpokenText } from "@/lib/speech";
import { playVoice, preloadVoice, repClips, sessionClips, stopVoice, voiceBusy, voiceReady } from "@/lib/voice";
import { matchCommand, onHeard, stopListening, watchListening } from "@/lib/listen";
import { FallWatch } from "@/lib/pose/fall";

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
function say(clips: string[], text: string, when: "now" | "next" | "queue" = "queue") {
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
  const [listening, setListening] = useState(false);
  const okayRef = useRef<() => void>(() => {});
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
    const counter = new RepCounter(profile.counter);
    const frames: Frame[] = [];
    const kneesInFlags: boolean[] = [];
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
      setup_step_back: "Step back a little, so I can see all of you, feet too.",
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
    // ---- Emergency: a possible fall, or "help" / "call 911" out loud. Counting stops, the screen asks
    // "Are you okay?" with buttons to call 911 or the emergency contact, the coach asks out loud, and the
    // physiotherapist gets an alert. Nothing calls anyone by itself: the patient answers or taps.
    const fallWatch = new FallWatch();
    let emergencyOn = false;
    let emergencyTimer = 0;
    const raiseEmergency = (reason: "fall" | "help", asked: Emergency["asked"] = "none") => {
      if (!emergencyOn) {
        emergencyOn = true;
        const first = reason === "fall" ? ["fall_check", "ask_help"] : ["help_check", "ask_help"];
        const text = reason === "fall" ? "Are you okay? It looks like you went down." : "I'm here. Are you okay?";
        say(first, `${text} Tell me you're okay, or tap a button. I can call 911, or your emergency contact.`, "now");
        fetch("/api/session/alert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: p.token, kind: reason, exercise: p.exerciseName }),
        }).catch(() => {});
        // No answer: say that the physiotherapist knows, and ask again, every 25 s.
        const again = () => {
          if (!emergencyOn) return;
          say(["told_physio", "ask_help"], "I've let your physiotherapist know. Tell me you're okay, or tap a button.", "queue");
          emergencyTimer = window.setTimeout(again, 25000);
        };
        emergencyTimer = window.setTimeout(again, 25000);
      }
      if (asked === "911") say(["tap_911"], "Tap the red button to call 911.", "now");
      if (asked === "contact") say(["tap_contact"], "Tap the button to call your emergency contact.", "now");
      setEmergency((e) => ({ reason: e?.reason ?? reason, asked: asked !== "none" ? asked : e?.asked ?? "none" }));
    };
    okayRef.current = () => {
      if (!emergencyOn) return;
      emergencyOn = false;
      window.clearTimeout(emergencyTimer);
      setEmergency(null);
      counter.resetAfterTrackingGap();
      stableFrames = 0;
      say(["glad_ok"], "Glad you're okay. Take your time, then carry on.", "now");
    };
    // What the microphone hears. Ignored while the coach is talking, and the same command twice within 4 s counts once.
    let lastCommand = { what: "", at: 0 };
    onHeard((heard) => {
      if (finished || cancelled || voiceBusy()) return;
      const command = matchCommand(heard, p.emergency?.name ?? null);
      if (!command) return;
      const now = performance.now();
      if (command === lastCommand.what && now - lastCommand.at < 4000) return;
      lastCommand = { what: command, at: now };
      if (command === "help") raiseEmergency("help");
      else if (command === "call_911") raiseEmergency("help", "911");
      else if (command === "call_contact") raiseEmergency("help", p.emergency ? "contact" : "911");
      else if (command === "okay") okayRef.current();
      else if (command === "pain") hurtsRef.current();
    });
    const unwatchListening = watchListening(setListening);

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
      if (document.visibilityState === "visible" && !finished && !cancelled && video.paused && !video.ended) play().catch(() => {});
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
          if (probing) return;
          const result = pose.detectForVideo(video, ts) as {
            landmarks?: { x: number; y: number }[][];
            worldLandmarks?: { x: number; y: number; z: number }[][];
          };
          const world = result.worldLandmarks?.[0];
          if (!world) {
            if (fallWatch.missing(t)) raiseEmergency("fall");
            if (emergencyOn) { draw(undefined, connections, null); return; }
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
          if (fallWatch.seen(t, trunkLean(world.map((l) => [l.x, l.y, l.z] as Vec)), hipY)) raiseEmergency("fall");
          if (emergencyOn) { draw(screen, connections, null); return; }
          const issue = poseSetupIssue(p.exerciseId, screen);
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
          showSetupIssue(null);
          if (!startSpoken) {
            startSpoken = true;
            lastProgressAt = performance.now();
            const own = `start_${p.exerciseId}`;
            say([voiceReady([own]) ? own : "start"], `Camera's ready. We'll do ${p.exerciseName}: ${target} repetitions. Take your time.`);
          }
          const frame: Frame = world.map((l) => [l.x, l.y, l.z] as Vec);
          const signal = profile.repSignal(frame);
          const kneesIn = profile.liveWarning?.(frame, counter.isDown) ?? false;
          frames.push(frame);
          kneesInFlags.push(kneesIn);
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
          else if (!rep && lastProgressAt && performance.now() - lastProgressAt > 20000 && idleNudges < 3) {
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
            profile.fault({ rep, frames: slice, times: counter.times.slice(rep.startIndex, rep.endIndex + 1), liveFlags: flags }),
            quality === null ? null : 1 - quality, model?.flag_threshold,
          );
          if (!model) quality = ruleQuality(fault);
          const measure = Math.round(profile.repMeasure(rep));
          const r: RepResult = {
            quality, fault,
            knee_bend_deg: profile.measureColumn === "knee_bend_deg" ? measure : null,
            rom_deg: profile.measureColumn === "rom_deg" ? measure : null,
            duration_s: Number(rep.activeSeconds.toFixed(2)),
          };
          repResults.push(r);
          setResults([...repResults]);
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
          say(
            repClips(n, named, { allDone, setDone, leftInSet: p.reps - (((n - 1) % p.reps) + 1), halfway: target >= 8 && n * 2 === target }),
            allDone ? `${spoken} Nice work. That's all of them.`
              : setDone ? `${spoken} Set ${n / p.reps} is done. Take a breather, then continue.` : spoken,
            "next",       // a warning still being spoken finishes its sentence before the count
          );
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
      stopVoice();
      window.speechSynthesis?.cancel();
      window.clearTimeout(emergencyTimer);
      onHeard(null);
      stopListening();
      unwatchListening();
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
            <p>Getting the camera ready<small>Stand about 2.5 m back, so your whole body fits.</small></p>
          </div>
        )}
        {status === "running" && setupIssue && (
          <div className="stage-loading setup-check" role="status">
            <p>Camera check<small>{setupIssue}</small></p>
          </div>
        )}
        <div className="hud top">
          <span className="live"><i /> {status === "running" ? `33 body points${fps ? ` · ${fps} fps` : ""}${listening ? " · listening" : ""}` : status === "loading" ? "Starting camera…" : status === "paused" ? "Paused: come back to this page to continue" : status === "saving" ? "Saving…" : "Stopped"}</span>
          <span className="count" aria-live="polite">{done}<small> / {target}</small></span>
        </div>
        {status === "running" && !setupIssue && banner && <div className={`cue ${banner.tone}`} role="status">{banner.text}</div>}
        {status === "running" && !setupIssue && live && (
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
          {modelNote && <span className="model-note">{modelNote}</span>}
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
      <div className="quality-strip" aria-label="Quality of each repetition">
        {results.slice(-10).map((r, i) => (
          <span key={i} className={`chip ${r.fault ? "warn" : ""}`} title={r.fault ? CUE[r.fault] : "Good"}>
            {r.quality === null ? "✓" : Math.round(r.quality * 100)}
          </span>
        ))}
      </div>
      <div className="call-buttons">
        <button className="btn end" onClick={() => finishRef.current("ended")} disabled={status === "saving"}><Icon name="stop" /> End session</button>
        <button className="btn hurt" onClick={hurts}><Icon name="hand" /> It hurts</button>
      </div>
      <p className="voice-hint faint small">
        {listening
          ? <>Say <b>&ldquo;help&rdquo;</b>, <b>&ldquo;call 911&rdquo;</b>{p.emergency ? <>, <b>&ldquo;call {p.emergency.name}&rdquo;</b></> : null} or <b>&ldquo;it hurts&rdquo;</b> at any time. Your browser&apos;s speech service turns what you say into text; the video stays on this device.</>
          : <>If you fall, the camera asks if you are okay and offers to call for help.</>}
      </p>
      {emergency && (
        <div className="emergency" role="alertdialog" aria-labelledby="emergency-title" aria-describedby="emergency-sub">
          <div className="emergency-card">
            <h2 id="emergency-title">Are you okay?</h2>
            <p id="emergency-sub">
              {emergency.reason === "fall" ? "It looks like you went down." : "You asked for help."} Your physiotherapist has been told.
            </p>
            <button className="btn ok" onClick={() => okayRef.current()}>I&apos;m okay</button>
            <a className={`btn call-911${emergency.asked === "911" ? " asked" : ""}`} href="tel:911">Call 911</a>
            {p.emergency && (
              <a className={`btn call-contact${emergency.asked === "contact" ? " asked" : ""}`} href={`tel:${p.emergency.phone}`}>
                Call {p.emergency.name}
              </a>
            )}
            <p className="faint small">You can also say &ldquo;I&apos;m okay&rdquo;, &ldquo;call 911&rdquo;{p.emergency ? <> or &ldquo;call {p.emergency.name}&rdquo;</> : null}.</p>
          </div>
        </div>
      )}
    </section>
  );
}
