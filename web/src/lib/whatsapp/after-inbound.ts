// What happens after a patient's message has been stored, for WhatsApp and the demo phone alike: send what is ready
// now (safety replies, welcome, plans released by the 24-hour window), then let the AI coach answer the ordinary
// messages and send its replies. Runs after the HTTP response (next/server `after`).
import { coachReply } from "../coach/reply";
import { processOutbox } from "./outbox";

export async function deliverAndCoach(patients: string[], toCoach: { patientId: string; messageId: string }[]) {
  for (const id of patients) await processOutbox(id);
  for (const { patientId, messageId } of toCoach) {
    try {
      await coachReply(patientId, messageId);
    } catch (error) {
      console.error("[coach] failed:", error);
    }
    await processOutbox(patientId);
  }
}
