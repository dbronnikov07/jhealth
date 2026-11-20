// Manage patients: delete a patient (the same phone can then sign up again, as new), or start them over (history
// cleared, patient and plan kept). For demos and for tidying up test sign-ups. Signed-in staff only, like every
// /doctor page (the proxy gate, and requireDoctor in every read and action).
import Link from "next/link";
import { connection } from "next/server";
import { TopBar } from "@/components/TopBar";
import { getDoctor, listPatients } from "@/lib/data";
import { prettyPhone, timeAgo } from "@/lib/format";
import { clearPatientHistory, removePatient } from "../actions";
import { ConfirmButton } from "./ConfirmButton";

export const metadata = { title: "Manage patients · Motiva Health" };

export default async function ManagePage() {
  await connection();
  const [{ doctor, mode }, patients] = await Promise.all([getDoctor(), listPatients()]);
  const real = patients.filter((p) => !p.is_simulated);
  const simulated = patients.filter((p) => p.is_simulated);
  const row = (p: (typeof patients)[number]) => (
    <li key={p.id} className="manage-row">
      <div className="who-cell">
        <Link className="name" href={`/doctor/patients/${p.id}`}>{p.display_name}</Link>{" "}
        {p.is_simulated ? <span className="tag">Sim</span> : <span className="tag real">Real</span>}
        <div className="cond">
          {p.phone ? <span className="num">{prettyPhone(p.phone)}</span> : "no phone"} · {p.condition}
          {` · ${p.sessions_total} ${p.sessions_total === 1 ? "session" : "sessions"}`}
          {p.last_session_at ? ` · last ${timeAgo(p.last_session_at)}` : ""}
        </div>
      </div>
      <div className="manage-actions">
        <ConfirmButton action={clearPatientHistory.bind(null, p.id)} label="Start over" confirm="Tap again: clear history" />
        <ConfirmButton action={removePatient.bind(null, p.id)} label="Delete" confirm={`Tap again: delete ${p.display_name.split(" ")[0]}`} danger />
      </div>
    </li>
  );
  return (
    <>
      <TopBar doctor={doctor} mode={mode} />
      <main className="page">
        <Link href="/doctor" className="back">← All patients</Link>
        <header className="page-head">
          <div>
            <h1>Manage patients</h1>
            <p className="lede">
              <b>Delete</b> removes a patient and everything about them; their phone number can then message Motiva and
              sign up again as a new patient. <b>Start over</b> keeps the patient and their plan and clears the rest:
              sessions, chat, alerts, notes, wins, check-ups and phases. Neither can be undone.
            </p>
          </div>
        </header>
        <section className="card flush">
          <div className="card-head manage-head"><h2>Real patients</h2><span className="count">{real.length}</span></div>
          {real.length ? <ul className="manage-list">{real.map(row)}</ul> : <p className="empty">No real patients.</p>}
        </section>
        <section className="card flush">
          <div className="card-head manage-head"><h2>Simulated patients</h2><span className="count">{simulated.length}</span></div>
          <ul className="manage-list">{simulated.map(row)}</ul>
        </section>
      </main>
    </>
  );
}
