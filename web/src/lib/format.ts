import type { Status } from "./data";

export const STATUS_LABEL: Record<Status, string> = {
  alert: "Needs review",
  stalling: "Stalling",
  inactive: "Inactive",
  new: "New plan",
  no_plan: "No plan",
  on_track: "On track",
};

export function timeAgo(date: Date | string | null): string {
  if (!date) return "never";
  const seconds = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.floor(minutes)} min ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** "+1 416 555 0100" style, for reading only. */
export function prettyPhone(phone: string | null): string {
  if (!phone) return "";
  const m = phone.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `+1 ${m[1]} ${m[2]} ${m[3]}` : phone;
}

/**
 * Turns what a doctor types into the international format the database requires.
 * "416 555 0100" and "(416) 555-0100" become +14165550100 (Canada/US); anything else needs a + and country code.
 */
export function normalizePhone(raw: string): string | null {
  const text = raw.trim();
  const digits = text.replace(/\D/g, "");
  if (text.startsWith("+")) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  if (text.startsWith("00")) return /^[1-9]\d{7,14}$/.test(digits.slice(2)) ? `+${digits.slice(2)}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
