import Link from "next/link";
import { connection } from "next/server";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Goniometer } from "@/components/Goniometer";
import { Icon } from "@/components/Icon";
import { PhaseMini } from "@/components/PhaseStepper";
import { QrCode } from "@/components/QrCode";
import { TopBar } from "@/components/TopBar";
import { textUsLink } from "@/lib/imessage/format";
import { getDoctor, listPatients, openVisits, sessionsThisWeek, type Status } from "@/lib/data";
import { slotShort } from "@/lib/visits";
import { STATUS_LABEL, timeAgo } from "@/lib/format";
import { cameraTargetsMet, checkCriteria, phaseAt, protocolFor } from "@/lib/phases";

const IMESSAGE = process.env.IMESSAGE_ADDRESS?.trim() || null;

export default async function Dashboard() {
  await connection(); // always read fresh data, never a copy made at build time
  const [{ doctor, mode }, patients, sessions, visits] = await Promise.all([getDoctor(), listPatients(), sessionsThisWeek(), openVisits()]);
  const visitOf = new Map(visits.map((v) => [v.patient_id, v]));

  // A plan started in the last few days has not had a fair chance yet, so it does not pull the average down.
  const withPlan = patients.filter((p) => p.adherence_7d !== null && p.status !== "new");
  const adherence = withPlan.length ? withPlan.reduce((s, p) => s + (p.adherence_7d ?? 0), 0) / withPlan.length : 0;
  const simulated = patients.filter((p) => p.is_simulated).length;

  const count = (st: Status) => patients.filter((p) => p.status === st).length;
  const alerts = count("alert");
  const stalling = count("stalling");
  const quiet = count("inactive");
  const today = new Intl.DateTimeFormat("en-CA", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Toronto" }).format(new Date());
  // Camera targets for the current phase all met: worth the physio's look (the camera never signs off by itself).
  const ready = new Set(patients.filter((p) => {
    const ph = phaseAt(protocolFor(p.condition), p.phase);
    return ph !== null && p.prescription_id !== null &&
      cameraTargetsMet(checkCriteria(ph, { bend: p.bend_7d, days: p.days_active_7d, quality: p.quality_7d }));
  }).map((p) => p.id));
  const others = [ready.size ? `${ready.size} ${ready.size === 1 ? "is" : "are"} ready for a phase sign-off` : "", stalling ? `${stalling} ${stalling === 1 ? "is" : "are"} stalling` : "", quiet ? `${quiet} ${quiet === 1 ? "has" : "have"} gone quiet` : ""].filter(Boolean);
  // Groups in the order a physio works through them; real patients stay first inside each group.
  const groups = GROUPS.map((g) => ({ ...g, list: patients.filter((p) => p.status === g.status) })).filter((g) => g.list.length > 0);

  return (
    <>
      <TopBar doctor={doctor} mode={mode} />
      <AutoRefresh seconds={3} />
      <main className="page board">
        <header className="board-head">
          <div>
            <p className="eyebrow"><span className="live-dot">Live</span><span>{today}</span></p>
            <h1 className={alerts > 0 ? undefined : "calm"}>
              {alerts > 0
                ? <><mark>{alerts} {alerts === 1 ? "patient needs" : "patients need"}</mark> you today.</>
                : <>Nobody needs a <mark>review</mark> today.</>}
            </h1>
            <p className="board-sub">
              {others.length ? `${others.length > 1 ? `${others.slice(0, -1).join(", ")} and ${others.at(-1)}` : others[0]}. ` : "Everyone else is moving. "}
              A finished session shows up here within seconds.
            </p>
          </div>
          <Link href="/doctor/patients/new" className="btn primary"><Icon name="plus" size={18} /> Add patient</Link>
        </header>

        {IMESSAGE && (
          // Shown only to signed-in staff: on a personal Apple ID this address is someone's own phone number or email.
          <details className="imsg-invite">
            <summary>Patients start on iMessage: show the QR code to scan</summary>
            <div className="row">
              <QrCode text={textUsLink(IMESSAGE)} size={168} label="QR code: scan with an iPhone camera to text the Motiva coach" />
              <p>Scan with the iPhone camera, then press Send. The first text says &ldquo;Motiva&rdquo;, which is what lets a new patient in. <a href={textUsLink(IMESSAGE)}>Open Messages</a></p>
            </div>
          </details>
        )}

        <section className="figures" aria-label="This week">
          <div className="figure">
            <span className="n">{patients.length}</span>
            <span className="what">patients<small>{patients.length - simulated} real · {simulated} simulated</small></span>
          </div>
          <div className="figure">
            <span className="n">{sessions}</span>
            <span className="what">sessions in the last 7 days</span>
          </div>
          <div className="figure dark">
            <span className="n">{Math.round(adherence * 100)}%</span>
            <span className="what">average adherence</span>
            <span className="meter" aria-hidden><i style={{ width: `${Math.round(adherence * 100)}%` }} /></span>
          </div>
        </section>

        <div className="groups">
          {groups.map((g) => (
            <section key={g.status} className={`group st-${g.status}`} aria-labelledby={`g-${g.status}`}>
              <div className="group-head">
                <span className="dot" aria-hidden />
                <h2 id={`g-${g.status}`}>{g.title}</h2>
                <span className="count">{g.list.length}</span>
              </div>
              <div className="rows">
                {g.list.map((p) => (
                  <article key={p.id} className={`prow st-${p.status}`}>
                    <span className="ava" aria-hidden>{initials(p.display_name)}</span>
                    <div className="who-cell">
                      <Link className="name" href={`/doctor/patients/${p.id}`}>{p.display_name}</Link>{" "}
                      {p.is_simulated ? <span className="tag">Sim</span> : <span className="tag real">Real</span>}
                      <div className="cond">{p.condition}{p.side ? `, ${p.side}` : ""}</div>
                      <div className="phase-line">
                        <PhaseMini protocol={protocolFor(p.condition)} phase={p.phase} />
                        {ready.has(p.id) && <span className="tag ready">Ready to sign off</span>}
                        {visitOf.get(p.id)?.status === "confirmed" && visitOf.get(p.id)!.chosen_at && (
                          <span className="tag visit">Check-up {slotShort(new Date(visitOf.get(p.id)!.chosen_at!))}</span>
                        )}
                        {visitOf.get(p.id)?.status === "proposed" && <span className="tag">Check-up offered</span>}
                        {visitOf.get(p.id)?.status === "call_requested" && <span className="tag call">Wants a call</span>}
                      </div>
                    </div>
                    <p className="note"><span className="sr-only">{STATUS_LABEL[p.status]}: </span>{p.status_reason}</p>
                    <div className="cell adh">
                      {p.adherence_7d === null || !p.days_per_week ? <span className="dash">–</span> : (
                        <>
                          <span className="pips" aria-hidden>
                            {Array.from({ length: p.days_per_week }, (_, i) => <i key={i} className={i < p.days_active_7d ? "on" : ""} />)}
                          </span>
                          <span className="cap"><span className="sr-only">Exercised </span>{p.days_active_7d} of {p.days_per_week} days</span>
                        </>
                      )}
                    </div>
                    <div className="cell qual">
                      {p.quality_7d === null ? <span className="dash">–</span> : (
                        <>
                          <span className="val"><span className="sr-only">Rep quality </span><span className="big">{p.quality_7d}</span><span className="of">/100</span></span>
                          <span className="cap">
                            {p.quality_prev_7d === null ? "rep quality" : `${p.quality_7d >= p.quality_prev_7d ? "▲" : "▼"} from ${p.quality_prev_7d}`}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="cell bend">
                      {p.bend_7d === null ? <span className="dash">–</span> : (
                        <>
                          <span className="val">
                            <Goniometer value={p.bend_7d} previous={p.bend_prev_7d} size={28} />
                            <span className="big"><span className="sr-only">Knee bend </span>{p.bend_7d}°</span>
                          </span>
                          <span className="cap">{p.bend_prev_7d === null ? "knee bend" : `knee, was ${p.bend_prev_7d}°`}</span>
                        </>
                      )}
                    </div>
                    <span className="when">{timeAgo(p.last_session_at)}</span>
                    <Icon name="chevron" size={18} className="go" />
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>

        {simulated > 0 && (
          <p className="footnote">
            {simulated} of {patients.length} patients are simulated demo data (labelled Sim). Their numbers are generated, not measured.
            Knee bend is measured from one camera and is a trend, not a clinical measurement.
          </p>
        )}
      </main>
    </>
  );
}

/** "Margaret Demo" → "MD", "iMessage 0177" → "I0", "Simulated patient 01" → "SP". */
function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

const GROUPS: { status: Status; title: string }[] = [
  { status: "alert", title: "Needs you today" },
  { status: "stalling", title: "Stalling" },
  { status: "inactive", title: "Gone quiet" },
  { status: "new", title: "New plans" },
  { status: "on_track", title: "On track" },
  { status: "no_plan", title: "No plan yet" },
];
