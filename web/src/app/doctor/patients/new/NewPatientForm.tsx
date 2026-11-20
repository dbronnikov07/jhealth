"use client";
import { useActionState, useState } from "react";
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
  const [demo, setDemo] = useState(v.demo === "on");
  return (
    <form action={action} className="form-grid">
      <label className="field">
        Name
        <input type="text" name="name" required autoComplete="off" placeholder="First and last name" defaultValue={v.name} />
      </label>
      <label className="choice">
        <input type="checkbox" name="demo" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
        <span>
          <strong>Use the demo phone instead of WhatsApp</strong>
          <span className="how">
            The patient chats with the coach on a page of this site, with the same coach, pain rule and buttons. For
            demos, or while WhatsApp is unavailable.
          </span>
        </span>
      </label>
      <label className="field">
        {demo ? "Phone number (optional)" : "WhatsApp number"}
        <input type="tel" name="phone" required={!demo} autoComplete="off" placeholder={demo ? "Leave empty for a fictional number" : "+1 416 555 0123"} defaultValue={v.phone} />
        <span className="hint">
          {demo
            ? "Nothing is sent to this number. Leave it empty and a fictional +1 416 555 01xx number is used."
            : "The coach will message this number. A Canadian or US number can be typed without +1."}
        </span>
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
      <label className="field">
        Emergency contact (optional)
        <input type="text" name="emergency_name" autoComplete="off" maxLength={80} placeholder="For example: Mom, or Anna Lee" defaultValue={v.emergency_name} />
      </label>
      <label className="field">
        Emergency contact&apos;s phone (optional)
        <input type="tel" name="emergency_phone" autoComplete="off" placeholder="+1 416 555 0123" defaultValue={v.emergency_phone} />
        <span className="hint">If the camera sees a possible fall, or the patient asks for help, their screen offers to call this person.</span>
      </label>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <div className="row form-actions">
        <button className="btn primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Add patient"}</button>
        <span className="faint small">They are linked to you automatically.</span>
      </div>
    </form>
  );
}
