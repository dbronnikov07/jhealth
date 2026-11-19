import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Goniometer } from "@/components/Goniometer";
import { Icon } from "@/components/Icon";
import { Sparkline } from "@/components/Sparkline";
import { StatusPill } from "@/components/StatusPill";
import { TopBar } from "@/components/TopBar";
import {
  getActivePlan, getDoctor, getPatient, listExercises, listMemories, listMessages, openAlerts, recentSessions, sessionToken,
} from "@/lib/data";
import { prettyPhone, timeAgo } from "@/lib/format";
import { whatsappConfig } from "@/lib/whatsapp/client";
import { addNote, resolveAlert, retryMessages } from "../../actions";
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

  const [{ doctor, mode }, plan, exercises, sessions, memories, messages, alerts, token] = await Promise.all([
    getDoctor(), getActivePlan(id), listExercises(), recentSessions(id), listMemories(id), listMessages(id), openAlerts(id),
    sessionToken(id),
  ]);
  const whatsapp = whatsappConfig() !== null;
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
            <StatusPill status={patient.status} />
            <span className="spacer" />
            {plan && token && (
              <a className="btn open-link" href={`/s/${token}`} target="_blank" rel="noreferrer">
                Patient&apos;s page <Icon name="external" size={16} />
              </a>
            )}
          </div>
          <p className="facts">
            <span>{patient.condition}{patient.side ? `, ${patient.side} side` : ""}</span>
            {patient.phone && <span>WhatsApp <span className="num">{prettyPhone(patient.phone)}</span></span>}
            <span><span className="num">{patient.sessions_total}</span> sessions</span>
          </p>
        </header>
        <div className={`banner ${patient.status}`}><strong>{patient.status_reason}</strong></div>

        <div className="grid-2">
          <div className="stack">
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

            <section className="card">
              <div className="card-head">
                <h2>WhatsApp</h2>
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
      </main>
    </>
  );
}
