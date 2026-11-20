"use client";
// The patient's emergency contact: who their screen offers to call after a possible fall or a call for help.
import { useActionState } from "react";
import { saveEmergencyContact, type FormState } from "../../actions";

export function EmergencyForm({ patientId, name, phone }: { patientId: string; name: string | null; phone: string | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveEmergencyContact.bind(null, patientId), { error: null });
  const v = state.values ?? {};
  return (
    <details className="emergency-edit">
      <summary>{name ? "Change emergency contact" : "Add an emergency contact"}</summary>
      <form action={action} className="form-grid">
        <label className="field">
          Name
          <input type="text" name="emergency_name" autoComplete="off" maxLength={80} placeholder="For example: Mom" defaultValue={v.emergency_name ?? name ?? ""} />
        </label>
        <label className="field">
          Phone
          <input type="tel" name="emergency_phone" autoComplete="off" placeholder="+1 416 555 0123" defaultValue={v.emergency_phone ?? phone ?? ""} />
          <span className="hint">Leave both empty to remove the contact.</span>
        </label>
        {state.error && <p className="error" role="alert">{state.error}</p>}
        <div className="row form-actions">
          <button className="btn primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save contact"}</button>
        </div>
      </form>
    </details>
  );
}
