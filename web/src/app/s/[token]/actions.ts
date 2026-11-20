"use server";
// What the patient can change from their own page. The secret link is the key, as for the rest of the page.
import { refresh } from "next/cache";
import { getDb } from "@/lib/db";

/** The patient logs a real-life win ("Walked around the block"). At most 10 a day, 120 characters each. */
export async function logWin(token: string, form: FormData) {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return;
  const text = String(form.get("win") ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  if (text.length < 2) return;
  const db = await getDb();
  await db.query(
    `insert into wins (patient_id, text, author)
     select p.id, $2, 'patient' from patients p
      where p.session_token = $1
        and (select count(*) from wins w where w.patient_id = p.id and w.created_at > now() - interval '1 day') < 10`,
    [token, text],
  );
  refresh();
}
