"use client";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { CameraSession, type SessionSummary } from "./CameraSession";
import { unlockVoice } from "@/lib/voice";
import { configureListening, setRemoteVoice, startListening, type Ticket } from "@/lib/listen";

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
 * Short videos shown before an exercise: how it looks done right, and what does not count yet. Real people, faces not
 * blurred, open licences (public/demo/CREDITS.md). The "not yet" clips are labelled neutrally: they show a movement
 * the app would not count, not a person doing something wrong.
 */
type Demo = { src: string; label: string; note: string; ok: boolean; wide?: boolean };
const DEMOS: Record<string, { counts: string; credit: string; clips: Demo[] }> = {
  squat: {
    counts: "A squat counts when your knees bend about 55 degrees or more: sit back as if onto the chair, then stand up tall.",
    credit: "Videos: SHVETS production, olia danilevich, Pavel Danilyuk (Pexels).",
    clips: [
      { src: "/demo/squat_good_front.mp4", label: "Counts", note: "Sit back to about chair height", ok: true },
      { src: "/demo/squat_good_side.mp4", label: "Counts, from the side", note: "Hips back, chest up", ok: true },
      { src: "/demo/squat_shallow_front.mp4", label: "Doesn't count yet", note: "A small knee bend: go lower", ok: false },
    ],
  },
  sit_to_stand: {
    counts: "A sit-to-stand counts when you sit all the way down and stand up tall. Keep your arms crossed if you can.",
    credit: "Videos: U.S. CDC STEADI (public domain).",
    clips: [
      { src: "/demo/sit_to_stand_good.mp4", label: "Counts", note: "Arms crossed, stand up fully, sit down slowly", ok: true },
      { src: "/demo/sit_to_stand_hands.mp4", label: "Only if your physio says so", note: "Pushing up with your hands", ok: false },
    ],
  },
  arm_raise: {
    counts: "An arm raise counts when your straight arm goes out to the side to about shoulder height. Below about 60 degrees it does not count yet.",
    credit: "Video: SHVETS production (Pexels).",
    clips: [{ src: "/demo/arm_raise_good.mp4", label: "Counts", note: "Straight arms out to shoulder height, lower slowly", ok: true, wide: true }],
  },
};

function HowTo({ exerciseId }: { exerciseId: string }) {
  const demo = DEMOS[exerciseId];
  if (!demo) return null;
  return (
    <div className="howto">
      <div className="howto-row">
        {demo.clips.map((c) => (
          <figure key={c.src} className={`${c.ok ? "ok" : "wrong"}${c.wide ? " wide" : ""}`}>
            <video src={c.src} muted loop playsInline autoPlay preload="metadata" aria-label={`${c.label}: ${c.note}`} />
            <figcaption><b>{c.label}</b> {c.note}</figcaption>
          </figure>
        ))}
      </div>
      <p className="howto-counts">{demo.counts}</p>
      <p className="howto-credit faint small">{demo.credit}</p>
    </div>
  );
}

export function SessionApp({ token, items, source, step = false, emergency = null, listenTicket = null, voiceHelper = null }: {
  token: string; items: PlanItem[]; source: string | null; step?: boolean; emergency?: { name: string; phone: string } | null;
  listenTicket?: Ticket | null;
  /** The fast voice helper's address, when the team's computer is running it (else our hosted speech functions). */
  voiceHelper?: string | null;
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
              <button className="btn primary" onClick={() => { unlockVoice(); configureListening(listenTicket); setRemoteVoice(voiceHelper); startListening(); setActive(item.exercise_id); }}><Icon name="camera" /> Start with camera</button>
            ) : (
              <button className="btn" onClick={() => markDone(item)} disabled={busy === item.exercise_id}>
                {busy === item.exercise_id ? "Saving…" : <><Icon name="check" /> Mark done</>}
              </button>
            )}
            {item.tracking === "camera" && !done[item.exercise_id] && (
              <span className="ex-hint"><Icon name="distance" /> Stand about 2 m back, so the camera sees you from your shoulders to your knees. On a laptop, tilt the screen.</span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
