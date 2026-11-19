// Builds the JSON bodies the WhatsApp Cloud API expects (Graph API v27.0). Pure functions, no network.
// Limits from Meta's docs: text body 4096 chars, interactive body 1024, button label 20, footer 60.

export type Recipient = { phone: string | null; userId: string | null };

const clip = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 1) + "…");

/** Phone numbers are sent as digits only; a user known only by WhatsApp user ID gets `recipient` instead. */
function addressOf(r: Recipient): { to: string } | { recipient: string } {
  if (r.phone) return { to: r.phone.replace(/^\+/, "") };
  if (r.userId) return { recipient: r.userId };
  throw new Error("patient has neither a phone number nor a WhatsApp user ID");
}

export function textPayload(r: Recipient, body: string) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...addressOf(r),
    type: "text",
    text: { body: clip(body, 4096), preview_url: false },
  };
}

/** A message with one button that opens a link: the "Start session" button. */
export function ctaPayload(r: Recipient, body: string, label: string, url: string, footer?: string) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...addressOf(r),
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: { text: clip(body, 1024) },
      ...(footer ? { footer: { text: clip(footer, 60) } } : {}),
      action: { name: "cta_url", parameters: { display_text: clip(label, 20), url } },
    },
  };
}

/** Up to three quick-reply buttons, e.g. Done / Too hard / It hurts. */
export function buttonsPayload(r: Recipient, body: string, buttons: { id: string; title: string }[]) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...addressOf(r),
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: clip(body, 1024) },
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: clip(b.title, 20) } })) },
    },
  };
}
