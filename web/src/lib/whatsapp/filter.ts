// Which parts of a WhatsApp webhook are ours to handle. Pure functions (no database), so they are unit-tested.

/**
 * One Meta app (and one WhatsApp Business Account) can carry several phone numbers, and all of their events arrive at
 * the same webhook. Only events for our own number (WHATSAPP_PHONE_NUMBER_ID) are handled: a message to another number
 * must never be stored as a patient's, or answered from ours. Without a configured number (local tests), all pass.
 */
export function isOurNumber(metadata: { phone_number_id?: string } | undefined, ourNumberId: string | undefined): boolean {
  if (!ourNumberId) return true;
  return metadata?.phone_number_id === ourNumberId;
}

/**
 * Message types that are not something the patient said, so they get no reply: a reaction (a thumbs-up on our
 * message), a system notice (number changed), the "user opened the chat" event, and types WhatsApp could not read.
 * Text, buttons and media are handled as before.
 */
const NOT_A_MESSAGE = new Set(["reaction", "system", "unsupported", "request_welcome", "ephemeral", "unknown"]);

export function isConversational(type: string | undefined): boolean {
  return !!type && !NOT_A_MESSAGE.has(type);
}
