"use client";
// The live camera session. Everything runs on the patient's device: the video never leaves it.
// Per frame:      pose tracker (MediaPipe) -> the exercise's rep signal -> rep counter, skeleton, live warning
// Per repetition: the exported model scores it (features.ts + model.ts), the rules name any mistake (exercises.ts)
// At the end:     only the numbers are sent to /api/session.
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { CUE, profileFor, ruleQuality, withModelFlag, type Fault } from "@/lib/pose/exercises";
import { repFeatures, type Frame, type Vec } from "@/lib/pose/features";
import { describeModel, loadModel } from "@/lib/pose/loader";
import { mistakeProbability } from "@/lib/pose/model";
import { RepCounter } from "@/lib/pose/reps";

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
};

type Status = "loading" | "running" | "paused" | "saving" | "error";

function speak(text: string, interrupt = false) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (interrupt) window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  window.speechSynthesis.speak(u);
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
  const [cue, setCue] = useState<string | null>(null);
  const [modelNote, setModelNote] = useState<string | null>(null);
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
    let finished = false;

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
      if (reason === "target") speak("Well done. Session complete.", true);
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

    const draw = (points: { x: number; y: number }[] | undefined, kneesIn: boolean, connections: { start: number; end: number }[]) => {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!points) return;
      const w = canvas.width, h = canvas.height;
      ctx.lineWidth = Math.max(3, w / 300);
      ctx.strokeStyle = "rgba(93, 202, 165, 0.95)";
      for (const c of connections) {
        if (c.start < 11 || c.end < 11) continue; // skip the face
        ctx.beginPath();
        ctx.moveTo(points[c.start].x * w, points[c.start].y * h);
        ctx.lineTo(points[c.end].x * w, points[c.end].y * h);
        ctx.stroke();
      }
      for (let i = 11; i < points.length; i++) {
        const isKnee = i === 25 || i === 26;
        ctx.fillStyle = isKnee && kneesIn ? "#e24b4a" : "#ffffff";
        ctx.beginPath();
        ctx.arc(points[i].x * w, points[i].y * h, isKnee ? Math.max(8, w / 110) : Math.max(4, w / 220), 0, Math.PI * 2);
        ctx.fill();
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
        const pose = await make("GPU").catch(() => make("CPU"));
        landmarker = pose;
        const connections = vision.PoseLandmarker.POSE_CONNECTIONS;

        if (p.source) {
          video.src = p.source;
          video.muted = true;
        } else {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
          });
          video.srcObject = stream;
        }
        /** Everything that happens for one video frame. t = seconds on the session clock, ts = tracker timestamp (ms). */
        const processFrame = (t: number, ts: number) => {
          const result = pose.detectForVideo(video, ts) as {
            landmarks?: { x: number; y: number }[][];
            worldLandmarks?: { x: number; y: number; z: number }[][];
          };
          const world = result.worldLandmarks?.[0];
          if (!world) {
            draw(undefined, false, connections);
            return;
          }
          const frame: Frame = world.map((l) => [l.x, l.y, l.z] as Vec);
          const signal = profile.repSignal(frame);
          const kneesIn = profile.liveWarning?.(frame, counter.isDown) ?? false;
          frames.push(frame);
          kneesInFlags.push(kneesIn);
          kneesInRun = kneesIn ? kneesInRun + 1 : 0;
          setBend(Math.round(profile.liveValue(frame)));
          draw(result.landmarks?.[0], kneesIn, connections);

          // Say it at the moment it happens: a live warning (knees caving) for about half a second, once per repetition.
          const liveCue = profile.liveWarningFault ? CUE[profile.liveWarningFault] : null;
          if (kneesInRun === 8 && liveCue) {
            setCue(liveCue);
            if (!cueSpokenThisRep && performance.now() - lastSpokenCue > 4000) {
              speak(liveCue, true);
              cueSpokenThisRep = true;
              lastSpokenCue = performance.now();
            }
          }

          const rep = counter.push(t, signal);
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
          setCue(fault ? CUE[fault] : null);
          cueSpokenThisRep = false;

          const n = repResults.length;
          speak(fault && fault !== profile.liveWarningFault ? `${n}. ${CUE[fault]}` : String(n), true);
          if (n >= target) return finish("target");
          if (n % p.reps === 0) speak(`Set ${n / p.reps} done. Rest a moment, then continue.`);
        };

        if (p.source && p.step) {
          // Deterministic test mode: seek through the file at 15 frames per video second, whatever the browser's speed.
          await new Promise((r) => (video.readyState >= 1 ? r(null) : video.addEventListener("loadedmetadata", r, { once: true })));
          setStatus("running");
          for (let t = 0; t < video.duration && !cancelled && !finished; t += 1 / 15) {
            video.currentTime = t;
            await new Promise((r) => video.addEventListener("seeked", r, { once: true }));
            if (cancelled || finished) break;
            processFrame(t, Math.round(t * 1000) + 1);
          }
          if (!cancelled) finish("ended");
          return;
        }

        await play();
        if (cancelled) return stop();
        speak(`Let's start. ${p.exerciseName}, ${target} repetitions.`);
        if (p.source) video.onended = () => finish("ended");

        const loop = () => {
          if (cancelled || finished || !landmarker) return;
          raf = requestAnimationFrame(loop);
          if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
          lastVideoTime = video.currentTime;
          const ts = Math.max(lastTs + 1, Math.round(performance.now()));
          lastTs = ts;
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
      window.speechSynthesis?.cancel();
    };
    // The session runs once per mount; its inputs do not change while it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = results.length;
  const scores = results.map((r) => r.quality).filter((q): q is number => q !== null);
  const avg = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) : null;

  const hurts = async () => {
    stopRef.current();
    window.speechSynthesis?.cancel();
    const res = await fetch("/api/session/pain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: p.token, exercise: p.exerciseName }),
    }).catch(() => null);
    const data = res && res.ok ? await res.json() : null;
    p.onPain(data?.message ?? "Please stop exercising. If the pain is severe or comes with chest pain or trouble breathing, call 911.");
  };

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
        <div className="hud top">
          <span className="live"><i /> {status === "running" ? "Coach is watching" : status === "loading" ? "Starting camera…" : status === "paused" ? "Paused: come back to this page to continue" : status === "saving" ? "Saving…" : "Stopped"}</span>
          <span className="count" aria-live="polite">{done}<small> / {target}</small></span>
        </div>
        {cue && <div className="cue" role="status"><Icon name="speaker" />{cue}</div>}
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
    </section>
  );
}
