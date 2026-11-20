import Link from "next/link";
import { connection } from "next/server";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Goniometer } from "@/components/Goniometer";
import { Icon } from "@/components/Icon";
import { StatusPill } from "@/components/StatusPill";
import { QrCode } from "@/components/QrCode";
import { TopBar } from "@/components/TopBar";
import { textUsLink } from "@/lib/imessage/format";
import { getDoctor, listPatients, sessionsThisWeek } from "@/lib/data";
import { STATUS_LABEL, timeAgo } from "@/lib/format";

const IMESSAGE = process.env.IMESSAGE_ADDRESS?.trim() || null;

export default async function Dashboard() {
  await connection(); // always read fresh data, never a copy made at build time
  const [{ doctor, mode }, patients, sessions] = await Promise.all([getDoctor(), listPatients(), sessionsThisWeek()]);

  const attention = patients.filter((p) => ["alert", "stalling", "inactive"].includes(p.status)).length;
  // A plan started in the last few days has not had a fair chance yet, so it does not pull the average down.
  const withPlan = patients.filter((p) => p.adherence_7d !== null && p.status !== "new");
  const adherence = withPlan.length ? withPlan.reduce((s, p) => s + (p.adherence_7d ?? 0), 0) / withPlan.length : 0;
  const simulated = patients.filter((p) => p.is_simulated).length;
  const byStatus = (["alert", "stalling", "inactive"] as const)
    .map((s) => ({ s, n: patients.filter((p) => p.status === s).length }))
    .filter((x) => x.n > 0);

  return (
    <>
      <TopBar doctor={doctor} mode={mode} />
      <AutoRefresh seconds={3} />
      <main className="page">
        <div className="page-head">
          <div>
            <h1>Patients</h1>
            <p className="lede">
              <span className="live-dot">Live</span>
              <span>A finished session shows up here within seconds. Real patients first, then whoever needs you most.</span>
            </p>
          </div>
          <span className="spacer" />
          <Link href="/doctor/patients/new" className="btn primary"><Icon name="plus" size={18} /> Add patient</Link>
        </div>
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

        <section className="stats" aria-label="This week">
          <div className="stat">
            <div className="label">Patients</div>
            <div className="value">{patients.length}</div>
            <div className="detail">{patients.length - simulated} real · {simulated} simulated</div>
          </div>
          <div className={`stat attention${attention === 0 ? " calm" : ""}`}>
            <div className="label">Need attention</div>
            <div className="value">{attention}</div>
            {byStatus.length > 0 && (
              <div className="breakdown">
                {byStatus.map(({ s, n }) => (
                  <span key={s} className={`st-${s}`}><i aria-hidden />{n} {STATUS_LABEL[s].toLowerCase()}</span>
                ))}
              </div>
            )}
          </div>
          <div className="stat">
            <div className="label">Sessions, last 7 days</div>
            <div className="value">{sessions}</div>
          </div>
          <div className="stat">
            <div className="label">Average adherence</div>
            <div className="value">{Math.round(adherence * 100)}%</div>
            <div className="meter" aria-hidden><i style={{ width: `${Math.round(adherence * 100)}%` }} /></div>
          </div>
        </section>

        <section className="card flush" aria-label="Patient list">
          <table className="patients">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Status</th>
                <th className="hide-sm">Adherence, 7 days</th>
                <th className="hide-sm">Rep quality</th>
                <th>Knee bend</th>
                <th className="hide-sm">Last session</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => {
                const perWeek = p.days_per_week ?? 0;
                return (
                  <tr key={p.id} className={`st-${p.status}${p.is_simulated ? "" : " real"}`}>
                    <td>
                      <Link className="name" href={`/doctor/patients/${p.id}`}>{p.display_name}</Link>{" "}
                      {p.is_simulated ? <span className="tag">Simulated</span> : <span className="tag real">Real</span>}
                      <div className="cell-sub">{p.condition}{p.side ? `, ${p.side}` : ""}</div>
                    </td>
                    <td className="status-cell">
                      <StatusPill status={p.status} />
                      <div className="cell-sub">{p.status_reason}</div>
                    </td>
                    <td className="hide-sm num">
                      {p.adherence_7d === null || !p.days_per_week ? <span className="faint">–</span> : (
                        <>
                          {perWeek > 0 && (
                            <span className="pips" aria-hidden>
                              {Array.from({ length: perWeek }, (_, i) => <i key={i} className={i < p.days_active_7d ? "on" : ""} />)}
                            </span>
                          )}
                          {p.days_active_7d}/{p.days_per_week} days
                        </>
                      )}
                    </td>
                    <td className="hide-sm num">
                      {p.quality_7d === null ? <span className="faint">–</span> : (
                        <>
                          {p.quality_7d}/100
                          {p.quality_prev_7d !== null && (
                            <span className={`delta ${p.quality_7d >= p.quality_prev_7d ? "up" : "down"}`}>
                              {p.quality_7d >= p.quality_prev_7d ? "▲" : "▼"} <span className="faint">from {p.quality_prev_7d}</span>
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="num">
                      {p.bend_7d === null ? <span className="faint">–</span> : (
                        <span className="bend-cell">
                          <Goniometer value={p.bend_7d} previous={p.bend_prev_7d} size={30} />
                          {p.bend_prev_7d === null ? `${p.bend_7d}°` : (
                            <span>{p.bend_prev_7d}°<span className="arrow"> → </span>{p.bend_7d}°</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="hide-sm muted small">{timeAgo(p.last_session_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {simulated > 0 && (
          <p className="footnote">
            {simulated} of {patients.length} patients are simulated demo data (labelled). Their numbers are generated, not measured.
            Knee bend is measured from one camera and is a trend, not a clinical measurement.
          </p>
        )}
      </main>
    </>
  );
}
