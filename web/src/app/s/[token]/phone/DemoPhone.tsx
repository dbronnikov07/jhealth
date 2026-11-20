"use client";
// The demo phone's chat (see lib/demo-phone.ts). Polls the server every few seconds, like a phone receiving messages.
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Goniometer } from "@/components/Goniometer";
import { Icon } from "@/components/Icon";
import type { PhoneMessage } from "@/lib/demo-phone";

const POLL_MS = 2500;
const TYPING_MAX_MS = 45_000;
const SUGGESTIONS = ["Hi! I'm ready for today", "Can I do it in the evening instead?", "Sharp pain in my knee, 8 out of 10"];

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

export function DemoPhone({ token, firstName }: { token: string; firstName: string }) {
  const [messages, setMessages] = useState<PhoneMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  const call = useCallback(async (body: object) => {
    const res = await fetch("/api/demo-phone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, ...body }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Something went wrong. Try again.");
    return data;
  }, [token]);

  const refresh = useCallback(async () => {
    try {
      const data = (await call({ action: "list" })) as { messages: PhoneMessage[] };
      setMessages(data.messages);
    } catch {
      /* the next poll tries again */
    }
  }, [call]);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  // "typing…" from the moment a question is sent until the coach's answer arrives (or it gives up).
  const last = messages?.[messages.length - 1];
  useEffect(() => {
    if (waitingSince === null) return;
    if (last && !last.mine && new Date(last.at).getTime() >= waitingSince - 2000) setWaitingSince(null);
    const t = setTimeout(() => setWaitingSince(null), TYPING_MAX_MS);
    return () => clearTimeout(t);
  }, [last, waitingSince]);
  const typing = waitingSince !== null;

  // Follow new messages unless the reader has scrolled up to read older ones.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);
  const onScroll = () => {
    const el = listRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  async function send(input: { text: string } | { button: string }) {
    if (sending) return;
    setSending(true);
    setError(null);
    stickToBottom.current = true;
    try {
      const sentAt = Date.now();
      const data = (await call({ action: "send", ...input })) as { coachWillAnswer?: boolean };
      if ("text" in input) setDraft("");
      // Safety replies and button answers come back at once; only the AI coach takes a few seconds.
      setWaitingSince(data.coachWillAnswer ? sentAt : null);
      await refresh();
      setTimeout(refresh, 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send. Try again.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (text) send({ text });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) onSubmit(e);
  };

  return (
    <section className="dp-phone" aria-label={`Chat between ${firstName} and the Motiva coach`}>
      <header className="dp-head">
        <span className="dp-avatar" aria-hidden><Goniometer value={typing ? 88 : 62} size={30} /></span>
        <span className="dp-who">
          <strong>Motiva coach</strong>
          <span className="dp-status" aria-live="polite">{typing ? "typing…" : "Demo phone · not WhatsApp"}</span>
        </span>
      </header>

      <ol className="dp-wall" ref={listRef} onScroll={onScroll} aria-live="polite" aria-relevant="additions">
        {messages === null && <li className="dp-note">Loading the chat…</li>}
        {messages?.length === 0 && (
          <li className="dp-note">
            No messages yet. When your physiotherapist sends your plan, it arrives here. You can also say hi to the coach.
          </li>
        )}
        {messages?.map((m, i) => {
          const newDay = i === 0 || dayLabel(messages[i - 1].at) !== dayLabel(m.at);
          return (
            <li key={m.id} className="dp-row">
              {newDay && <span className="dp-day">{dayLabel(m.at)}</span>}
              <div className={`dp-bubble ${m.mine ? "mine" : "theirs"}`}>
                {m.ai && <span className="dp-ai">AI coach</span>}
                <p className="dp-text">{m.text}</p>
                <span className="dp-time">{timeOf(m.at)}</span>
                {m.start && (
                  <a className="dp-cta" href={`/s/${token}`}>
                    <Icon name="play" size={14} /> Start session
                  </a>
                )}
              </div>
              {m.buttons.length > 0 && (
                <div className="dp-quick" role="group" aria-label="Quick replies">
                  {m.buttons.map((b) => (
                    <button key={b.id} type="button" className={b.id === "why_pain" ? "danger" : ""} disabled={sending} onClick={() => send({ button: b.id })}>
                      {b.title}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
        {typing && (
          <li className="dp-row">
            <div className="dp-bubble theirs dp-typing" aria-label="The coach is typing"><i /><i /><i /></div>
          </li>
        )}
      </ol>

      {error && <p className="dp-error" role="alert">{error}</p>}
      {!draft && messages !== null && messages.length < 12 && (
        <div className="dp-suggest" aria-label="Example messages">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => { setDraft(s); inputRef.current?.focus(); }}>{s}</button>
          ))}
        </div>
      )}
      <form className="dp-compose" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="dp-input">Message the coach</label>
        <textarea
          id="dp-input"
          ref={inputRef}
          rows={1}
          maxLength={1000}
          placeholder="Message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
        <button className="dp-send" type="submit" disabled={sending || !draft.trim()} aria-label="Send">
          <Icon name="send" size={20} />
        </button>
      </form>
    </section>
  );
}
