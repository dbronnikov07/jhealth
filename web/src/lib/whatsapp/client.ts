// Sends one message to the WhatsApp Cloud API. Configured entirely by environment variables (see .env.example).

export type WhatsAppConfig = { token: string; phoneNumberId: string; base: string; version: string };

export function whatsappConfig(): WhatsAppConfig | null {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return null;
  return {
    token,
    phoneNumberId,
    base: (process.env.WHATSAPP_API_BASE ?? "https://graph.facebook.com").replace(/\/$/, ""),
    version: process.env.WHATSAPP_API_VERSION ?? "v27.0",
  };
}

export class WhatsAppError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** What the doctor should read on the dashboard when WhatsApp refuses a message. */
function explain(code: string, fallback: string): string {
  switch (code) {
    case "131047":
      return "Waiting for the patient: WhatsApp only allows these messages within 24 hours of the patient's last message. It is sent automatically when they write.";
    case "131030":
      return "This number is not on the test number's list of allowed recipients. Add it in Meta's WhatsApp > API Setup.";
    case "190":
      return "The WhatsApp access token is invalid or expired. Create a new one in Meta's API Setup.";
    case "131026":
      return "WhatsApp could not deliver to this number. Check that it uses WhatsApp.";
    default:
      return fallback;
  }
}

/** Returns WhatsApp's message id (wamid...). Throws WhatsAppError with a readable message. */
export async function sendToWhatsApp(cfg: WhatsAppConfig, payload: object): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${cfg.base}/${cfg.version}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new WhatsAppError("network", `Could not reach WhatsApp (${error instanceof Error ? error.message : "network error"}). Retry later.`);
  }
  const data = (await response.json().catch(() => ({}))) as {
    messages?: { id: string }[];
    error?: { code?: number | string; message?: string; error_data?: { details?: string } };
  };
  if (!response.ok || !data.messages?.[0]?.id) {
    const code = String(data.error?.code ?? response.status);
    throw new WhatsAppError(code, explain(code, data.error?.error_data?.details ?? data.error?.message ?? `WhatsApp error ${code}`));
  }
  return data.messages[0].id;
}
