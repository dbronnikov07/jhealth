"use client";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { CameraSession, type SessionSummary } from "./CameraSession";
import { unlockVoice } from "@/lib/voice";

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

export function SessionApp({ token, items, source, step = false }: { token: string; items: PlanItem[]; source: string | null; step?: boolean }) {
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
          <div className="ex-action">
            {done[item.exercise_id] ? (
              <span className="done-badge"><Icon name="check" /> {done[item.exercise_id]}</span>
            ) : item.tracking === "camera" ? (
              <button className="btn primary" onClick={() => { unlockVoice(); setActive(item.exercise_id); }}><Icon name="camera" /> Start with camera</button>
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
