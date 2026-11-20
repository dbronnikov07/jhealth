"use client";
// Propose a check-up visit: one or two times on the clinic's clock. The patient answers with a tap in the chat.
import { useActionState } from "react";
import { proposeVisit, type FormState } from "../../actions";

export function VisitForm({ patientId, firstName, defaults, again = false }: {
  patientId: string; firstName: string; defaults: [string, string]; again?: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(proposeVisit.bind(null, patientId), { error: null });
  const v = state.values ?? {};
  return (
    <form action={action} className="visit-form">
      <div className="visit-slots">
        <label className="field">
          First time
          <input type="datetime-local" name="slot1" required defaultValue={v.slot1 ?? defaults[0]} />
        </label>
        <label className="field">
          Second time <span className="hint">(optional)</span>
          <input type="datetime-local" name="slot2" defaultValue={v.slot2 ?? defaults[1]} />
        </label>
      </div>
      <label className="field">
        What it is for <span className="hint">(optional, the patient sees it)</span>
        <input type="text" name="reason" maxLength={120} placeholder="For example: phase 1 review" defaultValue={v.reason ?? ""} />
      </label>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <div className="row form-actions">
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? "Sending…" : again ? `Send new times to ${firstName}` : `Offer these times to ${firstName}`}
        </button>
        <span className="faint small">Toronto time. {firstName} taps a time in the chat, or asks for a call.</span>
      </div>
    </form>
  );
}
