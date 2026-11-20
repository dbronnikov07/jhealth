"use client";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { CameraSession, type SessionSummary } from "./CameraSession";
import { unlockVoice } from "@/lib/voice";
import { startListening } from "@/lib/listen";

export type PlanItem = {
  exercise_id: string;
  name: string;
  instructions: string;
  sets: number;
  reps: number;
  tracking: "camera" | "manual";
  model_key: string | null;
  done_today: boolean;
};

/**
 * Short videos shown before an exercise: how it looks done right, from the front and the side, and the most common
 * way to get it wrong. Real people from an open dataset (public/demo/CREDITS.md), faces blurred by its authors.
 */
const DEMOS: Record<string, { counts: string; clips: { src: string; label: string; note: string; ok: boolean }[] }> = {
  squat: {
    counts: "A squat counts when your knees bend about 55 degrees or more: sit back as if onto the chair, then stand up tall.",
    clips: [
      { src: "/demo/squat_good_front.mp4", label: "Right", note: "Hips back, thighs close to level", ok: true },
      { src: "/demo/squat_good_side.mp4", label: "Right, from the side", note: "Chest up, weight in the heels", ok: true },
      { src: "/demo/squat_bad_front.mp4", label: "Wrong", note: "Too shallow: this does not count", ok: false },
    ],
  },
};

function HowTo({ exerciseId }: { exerciseId: string }) {
  const demo = DEMOS[exerciseId];
  if (!demo) return null;
  return (
    <div className="howto">
      <div className="howto-row">
        {demo.clips.map((c) => (
          <figure key={c.src} className={c.ok ? "ok" : "wrong"}>
            <video src={c.src} muted loop playsInline autoPlay preload="metadata" aria-label={`${c.label}: ${c.note}`} />
            <figcaption><b>{c.label}</b> {c.note}</figcaption>
          </figure>
        ))}
      </div>
      <p className="howto-counts">{demo.counts}</p>
      <p className="howto-credit faint small">Videos: Mendeley Data, kgbb3yn47p, CC BY 4.0. Faces blurred by the authors.</p>
    </div>
  );
}

export function SessionApp({ token, items, source, step = false, emergency = null }: {
  token: string; items: PlanItem[]; source: string | null; step?: boolean; emergency?: { name: string; phone: string } | null;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>(
    Object.fromEntries(items.filter((i) => i.done_today).map((i) => [i.exercise_id, "Done today"])),
  );
  const [pain, setPain] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (pain) {
    return (
      <div className="banner-card" role="alert">
        <h2>Stopped. Your physiotherapist has been told.</h2>
        <p className="pain-message">{pain}</p>
      </div>
    );
  }

  const current = items.find((i) => i.exercise_id === active);
  if (current) {
    return (
      <CameraSession
        token={token}
        exerciseId={current.exercise_id}
        exerciseName={current.name}
        sets={current.sets}
        reps={current.reps}
        modelKey={current.model_key}
        source={source}
        step={step}
        onDone={(s: SessionSummary | null) => {
          if (s) {
            setDone((d) => ({
              ...d,
              [current.exercise_id]:
                `${s.reps} reps` +
                (s.quality !== null ? ` · quality ${s.quality}/100` : "") +
                (s.knee_bend !== null ? ` · knee bend ${s.knee_bend}°` : "") +
                (s.previous_knee_bend !== null ? ` (last time ${s.previous_knee_bend}°)` : ""),
            }));
          }
          setActive(null);
        }}
        onPain={setPain}
        emergency={emergency}
      />
    );
  }

  const markDone = async (item: PlanItem) => {
    setBusy(item.exercise_id);
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, exercise_id: item.exercise_id, source: "manual", reps_done: item.sets * item.reps }),
    }).catch(() => null);
    setBusy(null);
    if (res && (res.ok || res.status === 409)) setDone((d) => ({ ...d, [item.exercise_id]: "Done today" }));
  };

  return (
    <ol className="today">
      {items.map((item, n) => (
        <li key={item.exercise_id}>
          <div className="ex-head">
            <span className="ex-n" aria-hidden>{n + 1}</span>
            <div>
              <h2 className="ex-name"><span className="sr-only">{n + 1}. </span>{item.name}</h2>
              <p className="dose"><b>{item.sets}</b> sets of <b>{item.reps}</b></p>
            </div>
          </div>
          <p className="ex-how">{item.instructions}</p>
          {item.tracking === "camera" && !done[item.exercise_id] && <HowTo exerciseId={item.exercise_id} />}
          <div className="ex-action">
            {done[item.exercise_id] ? (
              <span className="done-badge"><Icon name="check" /> {done[item.exercise_id]}</span>
            ) : item.tracking === "camera" ? (
              <button className="btn primary" onClick={() => { unlockVoice(); startListening(); setActive(item.exercise_id); }}><Icon name="camera" /> Start with camera</button>
            ) : (
              <button className="btn" onClick={() => markDone(item)} disabled={busy === item.exercise_id}>
                {busy === item.exercise_id ? "Saving…" : <><Icon name="check" /> Mark done</>}
              </button>
            )}
            {item.tracking === "camera" && !done[item.exercise_id] && (
              <span className="ex-hint"><Icon name="distance" /> Stand about 2.5 m from the camera so your whole body, feet included, is visible.</span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
