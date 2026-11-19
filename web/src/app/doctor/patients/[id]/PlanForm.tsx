"use client";
import Link from "next/link";
import { useActionState } from "react";
import type { Exercise, PlanItem } from "@/lib/data";
import { savePlan, type FormState } from "../../actions";

export function PlanForm({
  patientId,
  exercises,
  current,
  currentDays,
  cancelHref,
}: {
  patientId: string;
  exercises: Exercise[];
  current: PlanItem[] | null;
  currentDays: number | null;
  cancelHref: string | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(savePlan.bind(null, patientId), { error: null });
  const chosen = new Map((current ?? []).map((item) => [item.exercise_id, item]));

  return (
    <form action={action} className="choose">
      {exercises.map((e) => {
        const item = chosen.get(e.id);
        return (
          <label key={e.id} className="choice">
            <input type="checkbox" name="exercise" value={e.id} defaultChecked={!!item} />
            <span>
              <strong>{e.name}</strong>{" "}
              {e.tracking === "camera" ? <span className="tag camera">Camera-scored</span> : <span className="tag">Self-reported</span>}
              <span className="how">{e.instructions}</span>
            </span>
            <span className="dose">
              <input type="number" name={`sets_${e.id}`} min={1} max={10} defaultValue={item?.sets ?? e.default_sets} aria-label={`${e.name} sets`} />
              sets ×
              <input type="number" name={`reps_${e.id}`} min={1} max={50} defaultValue={item?.reps ?? e.default_reps} aria-label={`${e.name} reps`} />
              reps
            </span>
          </label>
        );
      })}

      <div className="row">
        <label className="field">
          Days per week
          <select name="days_per_week" defaultValue={String(currentDays ?? 5)}>
            {[3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="field" style={{ flex: 1, minWidth: 220 }}>
          Note for the patient (optional)
          <input type="text" name="notes" placeholder="e.g. Go slowly the first week" maxLength={300} />
        </label>
      </div>

      {state.error && <p className="error" role="alert">{state.error}</p>}
      <div className="row form-actions">
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : current ? "Save new plan & message patient" : "Prescribe & message patient"}
        </button>
        {cancelHref && <Link href={cancelHref} className="btn">Cancel</Link>}
        <span className="faint small">Saving replaces the current plan and queues a WhatsApp message.</span>
      </div>
    </form>
  );
}
