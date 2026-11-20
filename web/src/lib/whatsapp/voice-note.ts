// Voice notes on WhatsApp. Meta sends only the note's id: we download the audio from Meta (with our token), decode it
// (WhatsApp voice notes are Ogg Opus), turn it into 16 kHz speech, and send that to our own speech to text: the
// team's fast helper while it is running, else the hosted function (api/stt.py). The text is then handled exactly
// like a typed message: the pain rule first, then sign-up or the coach. The audio is never stored.
import { OggOpusDecoder } from "ogg-opus-decoder";
import { sttTicket } from "../coach/voice-coach.ts";
import { getDb } from "../db.ts";
import type { WhatsAppConfig } from "./client.ts";

/** Longer notes are cut here (our speech to text takes at most 30 s at once); the patient is told. */
export const MAX_VOICE_SECONDS = 30;
const MAX_BYTES = 3 * 1024 * 1024;

/** Mono audio at any rate -> 16-bit samples at 16 kHz, at most `maxSeconds` (each output sample averages its share). */
export function toPcm16k(channel: Float32Array, rate: number, maxSeconds = MAX_VOICE_SECONDS): Int16Array {
  const step = rate / 16000;
  const n = Math.min(Math.floor(channel.length / step), Math.round(maxSeconds * 16000));
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * step);
    const b = Math.max(a + 1, Math.floor((i + 1) * step));
    let sum = 0;
    for (let k = a; k < b && k < channel.length; k++) sum += channel[k];
    const v = sum / (b - a);
    out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  return out;
}

/** An Ogg Opus file (a WhatsApp voice note) -> 16 kHz speech. Null if it is not one. */
export async function decodeVoiceNote(bytes: Uint8Array): Promise<{ pcm: Int16Array; seconds: number } | null> {
  const decoder = new OggOpusDecoder();
  try {
    await decoder.ready;
    const r = await decoder.decodeFile(bytes);
    if (!r.samplesDecoded || !r.channelData.length) return null;
    // Two channels (rare for a voice note): their average.
    let mono = r.channelData[0];
    if (r.channelData.length > 1) {
      mono = new Float32Array(r.samplesDecoded);
      for (let i = 0; i < r.samplesDecoded; i++) mono[i] = (r.channelData[0][i] + r.channelData[1][i]) / 2;
    }
    return { pcm: toPcm16k(mono.subarray(0, r.samplesDecoded), r.sampleRate), seconds: r.samplesDecoded / r.sampleRate };
  } catch {
    return null;
  } finally {
    decoder.free();
  }
}

/** The note's audio from Meta: first its address (needs our token), then the file (needs it again). */
export async function downloadMedia(cfg: WhatsAppConfig, mediaId: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!/^[0-9]{5,30}$/.test(mediaId)) return null;
  const auth = { Authorization: `Bearer ${cfg.token}` };
  const meta = await fetch(`${cfg.base}/${cfg.version}/${mediaId}`, { headers: auth, signal: AbortSignal.timeout(8000) });
  if (!meta.ok) return null;
  const info = (await meta.json().catch(() => ({}))) as { url?: string; mime_type?: string; file_size?: number };
  // Meta's media addresses are https; a local stand-in for Meta (development only) may be plain http on this computer.
  const allowed = /^https:\/\//.test(info.url ?? "") || (process.env.NODE_ENV !== "production" && /^http:\/\/127\.0\.0\.1:\d+\//.test(info.url ?? ""));
  if (!info.url || !allowed || (info.file_size ?? 0) > MAX_BYTES) return null;
  const file = await fetch(info.url, { headers: auth, signal: AbortSignal.timeout(10000) });
  if (!file.ok) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return null;
  return { bytes, mime: info.mime_type ?? file.headers.get("content-type") ?? "" };
}

/** 16 kHz speech -> text: the team's fast helper while it is checked in, otherwise our hosted function. */
export async function transcribePcm(pcm: Int16Array): Promise<string | null> {
  const ticket = sttTicket();
  if (!ticket) return null;
  const db = await getDb();
  const [helper] = await db.query<{ url: string }>(
    "select url from bridge_status where name = 'voice' and url is not null and last_seen > now() - interval '2 minutes'",
  );
  const hosted = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  const bases = [helper?.url, hosted].filter((b): b is string => !!b);
  const body = new Blob([new Uint8Array(pcm.buffer as ArrayBuffer, pcm.byteOffset, pcm.byteLength)], { type: "application/octet-stream" });
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/api/stt`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "x-exp": String(ticket.exp), "x-sig": ticket.sig },
        body,
        signal: AbortSignal.timeout(base === helper?.url ? 10000 : 30000),
      });
      if (!res.ok) continue;
      const { text } = (await res.json()) as { text?: string };
      return text?.trim() || null;
    } catch {
      // try the next one
    }
  }
  return null;
}

export type VoiceNoteResult = { text: string | null; reason: "ok" | "download" | "format" | "silent" | "stt"; seconds: number };

/** The whole path for one voice note. Never throws. Logs timings and the outcome, never the words. */
export async function transcribeVoiceNote(cfg: WhatsAppConfig, mediaId: string): Promise<VoiceNoteResult> {
  const t0 = Date.now();
  try {
    const media = await downloadMedia(cfg, mediaId);
    if (!media) return { text: null, reason: "download", seconds: 0 };
    const audio = await decodeVoiceNote(media.bytes);
    if (!audio) return { text: null, reason: "format", seconds: 0 };
    if (audio.seconds < 0.3) return { text: null, reason: "silent", seconds: audio.seconds };
    const text = await transcribePcm(audio.pcm);
    console.log(`[whatsapp] voice note: ${audio.seconds.toFixed(1)} s, ${text ? "transcribed" : "not transcribed"} in ${Date.now() - t0} ms`);
    return text ? { text, reason: "ok", seconds: audio.seconds } : { text: null, reason: "stt", seconds: audio.seconds };
  } catch {
    return { text: null, reason: "download", seconds: 0 };
  }
}
