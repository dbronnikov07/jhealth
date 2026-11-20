import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Goniometer } from "@/components/Goniometer";
import { Icon } from "@/components/Icon";
import { PhaseStepper } from "@/components/PhaseStepper";
import { Sparkline } from "@/components/Sparkline";
import { StatusPill } from "@/components/StatusPill";
import { TopBar } from "@/components/TopBar";
import {
  getActivePlan, getDoctor, getPatient, getRecovery, listExercises, listMemories, listMessages, listVisits, openAlerts, patientLink,
  recentSessions,
} from "@/lib/data";
import { defaultSlots, slotLong } from "@/lib/visits";
import { cameraTargetsMet, checkCriteria, DONE, nextClearance, PHASES, phaseAt, protocolFor } from "@/lib/phases";
import { prettyPhone, timeAgo } from "@/lib/format";
import { QrCode } from "@/components/QrCode";
import { whatsappConfig } from "@/lib/whatsapp/client";
import { sessionUrl } from "@/lib/whatsapp/outbox";
import { maskHandle } from "@/lib/imessage/format";
import { addNote, addWin, changePhase, closeVisit, resolveAlert, retryMessages } from "../../actions";
import { VisitForm } from "./VisitForm";
import { DeleteForm } from "./DeleteForm";
import { EmergencyForm } from "./EmergencyForm";
import { PlanForm } from "./PlanForm";

const OUT_STATUS: Record<string, (connected: boolean) => string> = {
  queued: (connected) => (connected ? "sending…" : "queued, WhatsApp not connected"),
  sending: () => "sending…",
  sent: () => "sent ✓",
  delivered: () => "delivered ✓✓",
  read: () => "read ✓✓",
  failed: () => "not sent",
  cancelled: () => "not sent",
};

const WIN_SOURCE: Record<string, string> = { patient: "Patient", doctor: "You", camera: "Camera", phase: "Sign-off" };

const MEMORY_LABEL: Record<string, string> = {
  pain: "Pain", preference: "Preference", goal: "Goal", barrier: "Barrier", history: "History", clinical_note: "Doctor's note",
};

export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await connection();
  const { id } = await params;
  const editing = (await searchParams).edit === "1";
  const patient = await getPatient(id);
  if (!patient) notFound();

  const [{ doctor, mode }, plan, exercises, sessions, memories, messages, alerts, link, recovery, visits] = await Promise.all([
    getDoctor(), getActivePlan(id), listExercises(), recentSessions(id), listMemories(id), listMessages(id), openAlerts(id),
    patientLink(id), getRecovery(id, patient.condition), listVisits(id),
  ]);
  const firstName = patient.display_name.trim().split(/\s+/)[0] || patient.display_name;
  // The open check-up, if any: waiting for an answer, wants a call, or booked. Otherwise the last one, for the record.
  const visit = visits.find((v) => ["proposed", "call_requested", "confirmed"].includes(v.status)) ?? null;
  const lastVisit = visits.find((v) => ["done", "missed"].includes(v.status)) ?? null;
  const protocol = protocolFor(patient.condition);
  const phase = phaseAt(protocol, patient.phase);
  const checked = phase ? checkCriteria(phase, { bend: patient.bend_7d, days: plan ? patient.days_active_7d : null, quality: patient.quality_7d }) : [];
  const measured = checked.some((c) => c.met !== null);
  const targetsMet = cameraTargetsMet(checked);
  const phaseDays = Math.max(0, Math.floor((Date.now() - new Date(patient.phase_since).getTime()) / 86_400_000));
  const token = link?.token ?? null;
  const demo = link?.channel === "demo";
  const imessage = link?.channel === "imessage";
  const channelName = demo ? "Demo phone" : imessage ? "iMessage" : "WhatsApp";
  const phoneUrl = demo && token ? sessionUrl(token)?.concat("/phone") ?? null : null;
  // The demo phone needs no WhatsApp: its messages are delivered as soon as they are queued.
  const whatsapp = demo || imessage || whatsappConfig() !== null;
  const failedCount = messages.filter((m) => m.status === "failed").length;
  const trend = sessions.filter((s) => s.bend !== null).reverse().map((s) => ({ at: new Date(s.started_at), value: s.bend as number }));

  return (
    <>
      <TopBar doctor={doctor} mode={mode} />
      {!editing && plan && <AutoRefresh seconds={4} />}
      <main className="page">
        <Link href="/doctor" className="back">← All patients</Link>
        <header className="record">
          <div className="row">
            <h1>{patient.display_name}</h1>
            {patient.is_simulated ? <span className="tag">Simulated</span> : <span className="tag real">Real</span>}
            {(demo || imessage) && <span className="tag camera">{channelName}</span>}
            <StatusPill status={patient.status} />
            <span className="spacer" />
            {demo && token && (
              <a className="btn open-link" href={`/s/${token}/phone`} target="_blank" rel="noreferrer">
                Demo phone <Icon name="external" size={16} />
              </a>
            )}
            {plan && token && (
              <a className="btn open-link" href={`/s/${token}`} target="_blank" rel="noreferrer">
                Patient&apos;s page <Icon name="external" size={16} />
              </a>
            )}
          </div>
          <p className="facts">
            <span>{patient.condition}{patient.side ? `, ${patient.side} side` : ""}</span>
            {imessage && link?.imessageHandle ? (
              <span>iMessage <span className="num">{link.imessageHandle.includes("@") ? maskHandle(link.imessageHandle) : prettyPhone(link.imessageHandle)}</span></span>
            ) : patient.phone && <span>{channelName} <span className="num">{prettyPhone(patient.phone)}</span></span>}
            <span><span className="num">{patient.sessions_total}</span> sessions</span>
            {link?.emergencyName && link.emergencyPhone && (
              <span>Emergency: {link.emergencyName} <span className="num">{prettyPhone(link.emergencyPhone)}</span></span>
            )}
          </p>
          <EmergencyForm patientId={patient.id} name={link?.emergencyName ?? null} phone={link?.emergencyPhone ?? null} />
        </header>
        <div className={`banner ${patient.status}`}><strong>{patient.status_reason}</strong></div>

        <div className="grid-2">
          <div className="stack">
            <section className="card recovery">
              <div className="card-head">
                <h2>Recovery phase</h2>
                <span className="faint small">{protocol.label} · you sign off each phase</span>
              </div>
              <PhaseStepper protocol={protocol} phase={patient.phase} />
              {phase ? (
                <div className="phase-now">
                  <p className="phase-title">
                    <b>Phase {patient.phase} of {PHASES}: {phase.name}</b>
                    <span className="faint"> · {phaseDays === 0 ? "since today" : `for ${phaseDays} ${phaseDays === 1 ? "day" : "days"}`}</span>
                  </p>
                  <p className="small muted">Before you sign it off:</p>
                  <ul className="criteria">
                    {checked.map((c) => (
                      <li key={c.text} className={c.met === null ? "physio" : c.met ? "met" : "unmet"}>
                        <span className="mark" aria-hidden>{c.met ? "✓" : ""}</span>
                        <span className="what">{c.text}</span>
                        <span className="how">{c.met === null ? "You check" : `Camera this week: ${c.reading}`}</span>
                      </li>
                    ))}
                  </ul>
                  <form action={changePhase.bind(null, patient.id, "next")} className="signoff">
                    <input type="hidden" name="from" value={patient.phase} />
                    <input type="text" name="note" placeholder="Note for the record (optional)" aria-label="Sign-off note" maxLength={500} />
                    <button className="btn primary" type="submit">
                      Sign off phase {patient.phase} <Icon name="arrow" size={16} />
                    </button>
                  </form>
                  <p className={`signoff-hint${targetsMet ? " ok" : ""}`}>
                    {targetsMet
                      ? `Camera targets met. Signing off unlocks: ${nextClearance(protocol, patient.phase)}. The patient gets a message.`
                      : measured
                        ? `Camera targets not met yet. Sign off only if you have checked in person. Unlocks: ${nextClearance(protocol, patient.phase)}.`
                        : `Signing off unlocks: ${nextClearance(protocol, patient.phase)}. The patient gets a message.`}
                  </p>
                </div>
              ) : (
                <p className="phase-title"><b>Every phase is signed off: {protocol.done}.</b></p>
              )}
              <div className="phase-foot">
                {patient.phase > 1 && (
                  <form action={changePhase.bind(null, patient.id, "back")}>
                    <input type="hidden" name="from" value={patient.phase} />
                    <button className="linkish" type="submit">Move back to phase {Math.min(patient.phase, DONE) - 1}</button>
                  </form>
                )}
                {recovery.signoffs.length > 0 && (
                  <details className="history">
                    <summary>Sign-off history ({recovery.signoffs.length})</summary>
                    <ul>
                      {recovery.signoffs.map((s, i) => (
                        <li key={i}>
                          <span>{s.to > s.from ? `Phase ${s.from} signed off` : `Moved back to phase ${s.to}`}{s.note ? `: ${s.note}` : ""}</span>
                          <span className="faint">{timeAgo(s.at)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              <p className="footnote">Example criteria from common {protocol.label.toLowerCase()} rehab protocols. Adapt them to your patient: the camera only shows targets, you decide.</p>
            </section>

            <section className="card visit-card">
              <div className="card-head">
                <h2>Check-up visit</h2>
                <span className="faint small">you decide when one is needed; {firstName} picks the time in the chat</span>
              </div>
              {visit?.status === "confirmed" && visit.chosen_at ? (
                <>
                  <p className="visit-when"><span className="pill on_track"><i aria-hidden />Booked</span> <b>{slotLong(new Date(visit.chosen_at))}</b></p>
                  <p className="muted small">{firstName} chose this time{visit.answered_at ? ` ${timeAgo(visit.answered_at)}` : ""}.{visit.reason ? ` For: ${visit.reason}.` : ""} After the visit, record it here, then sign off the phase or change the plan.</p>
                  <div className="row visit-actions">
                    <form action={closeVisit.bind(null, visit.id, "done")}><button className="btn primary" type="submit">Visit happened</button></form>
                    <form action={closeVisit.bind(null, visit.id, "missed")}><button className="btn" type="submit">Did not come</button></form>
                    <form action={closeVisit.bind(null, visit.id, "cancelled")}><button className="linkish" type="submit">Cancel and tell {firstName}</button></form>
                  </div>
                </>
              ) : visit?.status === "proposed" ? (
                <>
                  <p className="visit-when"><span className="pill new"><i aria-hidden />Waiting for {firstName}</span> <b>{visit.options.map((o) => slotLong(new Date(o))).join(" or ")}</b></p>
                  {visit.patient_note && <p className="visit-note"><b>{firstName} wrote:</b> &ldquo;{visit.patient_note}&rdquo;</p>}
                  <details className="history" open={!!visit.patient_note}>
                    <summary>Offer different times</summary>
                    <VisitForm patientId={patient.id} firstName={firstName} defaults={defaultSlots()} again />
                  </details>
                  <form action={closeVisit.bind(null, visit.id, "cancelled")} className="visit-actions"><button className="linkish" type="submit">Withdraw the offer</button></form>
                </>
              ) : visit?.status === "call_requested" ? (
                <>
                  <p className="visit-when"><span className="pill stalling"><i aria-hidden />Wants a call</span> <b>{firstName} asked the clinic to phone{patient.phone ? <> on <span className="num">{prettyPhone(patient.phone)}</span></> : ""}</b></p>
                  {visit.patient_note && <p className="visit-note"><b>{firstName} wrote:</b> &ldquo;{visit.patient_note}&rdquo;</p>}
                  <p className="muted small">Agree a time on the phone, then send it here so it is confirmed in the chat too.</p>
                  <VisitForm patientId={patient.id} firstName={firstName} defaults={defaultSlots()} again />
                </>
              ) : (
                <>
                  {lastVisit?.chosen_at && (
                    <p className="muted small visit-last">Last check-up: {slotLong(new Date(lastVisit.chosen_at))} · {lastVisit.status === "done" ? "happened" : "did not come"}</p>
                  )}
                  <VisitForm patientId={patient.id} firstName={firstName} defaults={defaultSlots()} />
                </>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Exercise plan</h2>
                {plan && <span className="faint small">since {new Date(plan.starts_on).toLocaleDateString("en-CA")}, {plan.days_per_week} days a week</span>}
                <span className="spacer" />
                {plan && !editing && <Link href={`?edit=1`} className="btn small">Change plan</Link>}
              </div>
              {plan && !editing ? (
                <>
                  <ol className="plan-list">
                    {plan.items.map((item) => (
                      <li key={item.position}>
                        <span className="n">{item.position}</span>
                        <span className="ex">
                          {item.name}
                          {item.tracking === "camera" ? <span className="tag camera">Camera-scored</span> : <span className="tag">Self-reported</span>}
                        </span>
                        <span className="dose">{item.sets} × {item.reps}</span>
                      </li>
                    ))}
                  </ol>
                  {plan.notes && <p className="plan-note">Note: {plan.notes}</p>}
                </>
              ) : (
                <PlanForm
                  patientId={patient.id}
                  exercises={exercises}
                  current={plan?.items ?? null}
                  currentDays={plan?.days_per_week ?? null}
                  cancelHref={plan ? `/doctor/patients/${patient.id}` : null}
                />
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Progress</h2>
                <span className="faint small">deepest knee bend per session, degrees</span>
              </div>
              {(patient.bend_7d !== null || patient.quality_7d !== null || patient.adherence_7d !== null) && (
                <div className="readouts">
                  <div className="readout">
                    <div className="label">Knee bend, last 7 days</div>
                    <div className="value">
                      {patient.bend_7d === null ? <span className="faint">–</span> : (
                        <>
                          <Goniometer value={patient.bend_7d} previous={patient.bend_prev_7d} size={44} ticks />
                          {patient.bend_7d}°
                          {patient.bend_prev_7d !== null && <span className="was">was {patient.bend_prev_7d}°</span>}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="readout">
                    <div className="label">Rep quality</div>
                    <div className="value">
                      {patient.quality_7d === null ? <span className="faint">–</span> : <>{patient.quality_7d}/100</>}
                      {patient.quality_7d !== null && patient.quality_prev_7d !== null && <span className="was">was {patient.quality_prev_7d}</span>}
                    </div>
                  </div>
                  <div className="readout">
                    <div className="label">Days active</div>
                    <div className="value">
                      {patient.adherence_7d === null || !patient.days_per_week ? <span className="faint">–</span> : <>{patient.days_active_7d}/{patient.days_per_week}</>}
                    </div>
                  </div>
                </div>
              )}
              {trend.length >= 2 && <Sparkline points={trend} />}
              {sessions.length > 0 ? (
                <div className="table-scroll"><table className="sessions">
                  <thead><tr><th>When</th><th>Exercise</th><th className="num">Reps</th><th className="num">Quality</th><th className="num" title="Deepest knee bend (squat, sit-to-stand), straightest knee (knee extension) or highest arm (arm raise)">Range</th></tr></thead>
                  <tbody>
                    {sessions.slice(0, 6).map((s, i) => (
                      <tr key={i}>
                        <td className="muted">{timeAgo(s.started_at)}</td>
                        <td>{s.exercise}</td>
                        <td className="num">{s.reps_done}{s.reps_target ? `/${s.reps_target}` : ""}</td>
                        <td className="num">{s.quality === null ? "–" : `${Math.round(s.quality * 100)}/100`}</td>
                        <td className="num">{s.bend !== null ? `${Math.round(s.bend)}°` : s.rom !== null ? `${Math.round(s.rom)}°` : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              ) : (
                <p className="empty">No sessions yet. They appear here as soon as the patient finishes one.</p>
              )}
            </section>
          </div>

          <div className="stack">
            {alerts.length > 0 && (
              <section className="card alerts">
                <div className="card-head">
                  <h2>Open alerts</h2>
                  <span className="count">{alerts.length}</span>
                </div>
                <ul className="alert-list">
                  {alerts.map((a) => (
                    <li key={a.id}>
                      <span className="detail">{a.detail}</span>
                      <form action={resolveAlert.bind(null, a.id)}>
                        <button className="btn small" type="submit">Mark reviewed</button>
                      </form>
                      <div className="meta">{timeAgo(a.created_at)}</div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="card wins-card">
              <div className="card-head">
                <h2>Wins</h2>
                <span className="count">{recovery.winsTotal}</span>
              </div>
              {recovery.wins.length === 0 ? (
                <p className="empty">No wins yet. The patient logs them on their page (&ldquo;Walked around the block&rdquo;), the camera adds new bests, and every sign-off lands here.</p>
              ) : (
                <ul className="wins">
                  {recovery.wins.slice(0, 8).map((w, i) => (
                    <li key={i}>
                      <span className={`win-src ${w.source}`}>{WIN_SOURCE[w.source]}</span>
                      <span className="what">{w.text}</span>
                      <span className="faint small">{timeAgo(w.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <form action={addWin.bind(null, patient.id)} className="add-note">
                <input type="text" name="win" placeholder="A win the patient told you about" aria-label="Log a win" maxLength={120} required minLength={2} />
                <button className="btn" type="submit">Log</button>
              </form>
            </section>

            <section className="card">
              <div className="card-head">
                <h2>What the coach remembers</h2>
                <span className="count">{memories.length} facts</span>
              </div>
              {memories.length === 0 ? (
                <p className="empty">Nothing yet. The coach saves facts from the chat here (pain, goals, preferences), each linked to the message it came from.</p>
              ) : (
                <ul className="memory">
                  {memories.map((m) => (
                    <li key={m.id} className={m.author}>
                      <div className="fact"><span className={`tag kind-${m.kind}`}>{MEMORY_LABEL[m.kind] ?? m.kind}</span> <span>{m.fact}</span></div>
                      {m.source && <div className="quote">“{m.source}”</div>}
                      <div className="meta">{m.author === "coach" ? "Saved by the coach" : "Added by you"} · {timeAgo(m.created_at)}</div>
                    </li>
                  ))}
                </ul>
              )}
              <form action={addNote.bind(null, patient.id)} className="add-note">
                <input type="text" name="fact" placeholder="Tell the coach something, e.g. avoid deep bends until week 3" aria-label="Note for the coach" maxLength={500} required minLength={3} />
                <button className="btn" type="submit">Add</button>
              </form>
            </section>

            {demo && phoneUrl && (
              <section className="card demo-phone-card">
                <div className="card-head">
                  <h2>Open the demo phone on a phone</h2>
                </div>
                <p className="muted small">
                  This patient chats with the coach on this site instead of WhatsApp. Scan the code with the phone you will
                  hold on stage; the Start button there opens the camera session.
                </p>
                <details className="qr-reveal">
                  <summary>Show the QR code</summary>
                  <QrCode text={phoneUrl} label="QR code that opens this patient's demo phone" />
                  <p className="faint small">Anyone who scans it can write as this patient, so show it only to your own phone.</p>
                </details>
              </section>
            )}

            <section className="card">
              <div className="card-head">
                <h2>{channelName}</h2>
                <span className="count">latest {messages.length}</span>
                <span className="spacer" />
                {failedCount > 0 && whatsapp && (
                  <form action={retryMessages.bind(null, patient.id)}>
                    <button className="btn small" type="submit">Retry sending</button>
                  </form>
                )}
              </div>
              {messages.length === 0 ? (
                <p className="empty">No messages yet.</p>
              ) : (
                <ul className="chat">
                  {[...messages].reverse().map((m) => (
                    <li key={m.id} className={m.direction}>
                      {m.type === "coach_reply" && <span className="ai">AI coach</span>}
                      {m.type === "coach_fallback" && <span className="ai failed">AI coach could not answer</span>}
                      {m.body}
                      {(m.start_button || m.type === "new_plan") && (
                        <span className="chat-button"><Icon name="play" size={14} /> Start session</span>
                      )}
                      <span className="meta">
                        <span>
                          {timeAgo(m.created_at)}
                          {m.direction === "out" && ` · ${OUT_STATUS[m.status]?.(whatsapp) ?? m.status}`}
                        </span>
                      </span>
                      {m.type === "coach_fallback" && m.coach_error && <span className="meta error">{m.coach_error}</span>}
                      {(m.status === "failed" || m.status === "cancelled") && m.error && <span className="meta error">{m.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
        <DeleteForm patientId={patient.id} name={patient.display_name} firstName={firstName} />
      </main>
    </>
  );
}
