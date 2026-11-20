// Talks to Adaption's hosted models (OpenAI-compatible Chat Completions). Server-side only: the key never
// reaches a browser. Configured by environment variables (see .env.example):
//   ADAPTION_API_KEY   required; without it the coach stays silent, as before
//   ADAPTION_MODEL     optional, default below (chosen by scripts/coach-eval.ts)
//   ADAPTION_API_BASE  optional, for tests

export const DEFAULT_MODEL = "glm-5.3-flash";

export type AdaptionConfig = { key: string; model: string; base: string };

export function adaptionConfig(): AdaptionConfig | null {
  const key = process.env.ADAPTION_API_KEY;
  if (!key) return null;
  return {
    key,
    model: process.env.ADAPTION_MODEL || DEFAULT_MODEL,
    base: (process.env.ADAPTION_API_BASE ?? "https://api.prod.adaptionlabs.ai/api/v1").replace(/\/$/, ""),
  };
}

export class AdaptionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type ChatResult = {
  content: string | null;
  model: string;
  ms: number;
  usage: { prompt_tokens?: number; completion_tokens?: number } | null;
};

/** One chat completion that must answer in the given JSON schema. Throws AdaptionError on any failure. */
export async function chatJson(
  cfg: AdaptionConfig,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  schema: { name: string; strict: boolean; schema: object },
  opts: { model?: string; timeoutMs?: number; maxTokens?: number } = {},
): Promise<ChatResult> {
  const model = opts.model ?? cfg.model;
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${cfg.base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model,
        messages,
        // Reasoning models think before answering and those tokens count here, so leave room.
        max_tokens: opts.maxTokens ?? 3500,
        temperature: 0.4,
        response_format: { type: "json_schema", json_schema: schema },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new AdaptionError(timedOut ? "timeout" : "network", timedOut ? "Adaption took too long to answer" : String(error));
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const body = JSON.parse(text);
      detail = body?.error?.message ?? body?.detail ?? body?.message ?? detail;
    } catch {}
    throw new AdaptionError(String(res.status), `Adaption answered ${res.status}: ${detail}`);
  }
  let body: { model?: string; choices?: { message?: { content?: string | null } }[]; usage?: ChatResult["usage"] };
  try {
    body = JSON.parse(text);
  } catch {
    throw new AdaptionError("bad_response", "Adaption's answer was not JSON");
  }
  return {
    content: body.choices?.[0]?.message?.content ?? null,
    model: body.model ?? model,
    ms: Date.now() - started,
    usage: body.usage ?? null,
  };
}

/**
 * One plain-text chat completion, for the spoken coach: no JSON, few tokens, short timeout. Throws AdaptionError.
 * Reasoning models may wrap their thinking in <think> tags; that part is removed.
 */
export async function chatText(
  cfg: AdaptionConfig,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  opts: { model?: string; timeoutMs?: number; maxTokens?: number } = {},
): Promise<ChatResult> {
  const model = opts.model ?? cfg.model;
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${cfg.base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model, messages, max_tokens: opts.maxTokens ?? 400, temperature: 0.6 }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new AdaptionError(timedOut ? "timeout" : "network", timedOut ? "Adaption took too long to answer" : String(error));
  }
  const text = await res.text();
  if (!res.ok) throw new AdaptionError(String(res.status), `Adaption answered ${res.status}: ${text.slice(0, 200)}`);
  let body: { model?: string; choices?: { message?: { content?: string | null } }[]; usage?: ChatResult["usage"] };
  try {
    body = JSON.parse(text);
  } catch {
    throw new AdaptionError("bad_response", "Adaption's answer was not JSON");
  }
  const content = (body.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return { content: content || null, model: body.model ?? model, ms: Date.now() - started, usage: body.usage ?? null };
}
