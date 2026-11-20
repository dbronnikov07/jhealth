"use client";
// "Delete patient": folded away at the bottom of the record, and confirmed by typing the patient's first name,
// because it removes everything about them and cannot be undone.
import { useActionState } from "react";
import { deletePatient, type FormState } from "../../actions";

export function DeleteForm({ patientId, name, firstName }: { patientId: string; name: string; firstName: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(deletePatient.bind(null, patientId), { error: null });
  return (
    <details className="danger-zone">
      <summary>Delete this patient</summary>
      <form action={action} className="form-grid">
        <p>
          This deletes <b>{name}</b> and everything about them: the plan, every session and repetition, messages,
          alerts, notes and what they said to the coach. <b>It cannot be undone.</b>
        </p>
        <label className="field">
          Type <b>{firstName}</b> to confirm
          <input type="text" name="confirm" autoComplete="off" autoCapitalize="off" spellCheck={false} defaultValue={state.values?.confirm ?? ""} />
        </label>
        {state.error && <p className="error" role="alert">{state.error}</p>}
        <div className="row form-actions">
          <button className="btn danger" type="submit" disabled={pending}>{pending ? "Deleting…" : `Delete ${firstName}`}</button>
        </div>
      </form>
    </details>
  );
}
