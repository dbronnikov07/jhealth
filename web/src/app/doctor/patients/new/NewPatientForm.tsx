"use client";
import { useActionState } from "react";
import { createPatient, type FormState } from "../../actions";

const CONDITIONS = [
  "Total knee replacement",
  "Knee osteoarthritis",
  "ACL reconstruction",
  "Total hip replacement",
  "Other",
];

export function NewPatientForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createPatient, { error: null });
  const v = state.values ?? {};
  return (
    <form action={action} className="form-grid">
      <label className="field">
        Name
        <input type="text" name="name" required autoComplete="off" placeholder="First and last name" defaultValue={v.name} />
      </label>
      <label className="field">
        WhatsApp number
        <input type="tel" name="phone" required autoComplete="off" placeholder="+1 416 555 0123" defaultValue={v.phone} />
        <span className="hint">The coach will message this number. A Canadian or US number can be typed without +1.</span>
      </label>
      <label className="field">
        Condition
        <select name="condition" defaultValue={v.condition || CONDITIONS[0]} key={`c-${v.condition}`}>
          {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label className="field">
        Side
        <select name="side" defaultValue={v.side || "right"} key={`s-${v.side}`}>
          <option value="right">Right</option>
          <option value="left">Left</option>
          <option value="both">Both</option>
        </select>
      </label>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <div className="row form-actions">
        <button className="btn primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Add patient"}</button>
        <span className="faint small">They are linked to you automatically.</span>
      </div>
    </form>
  );
}
