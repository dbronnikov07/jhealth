-- prescribe(): the doctor's "create this plan" button, as one database transaction.
-- It replaces the patient's current plan (if any), stores the exercises, and queues the WhatsApp
-- message that tells the patient. Either all of that happens or none of it does.
--
-- p_items is a JSON array such as
--   [{"exercise_id": "sit_to_stand", "sets": 2, "reps": 10}, {"exercise_id": "seated_knee_extension"}]
-- Missing sets/reps fall back to the exercise's defaults.

create function prescribe(p_patient uuid, p_items jsonb, p_days_per_week int default 5, p_notes text default null)
returns uuid language plpgsql as $$
declare
  v_doctor  uuid;
  v_first   text;
  v_rx      uuid;
  v_count   int;
  v_lines   text;
begin
  select doctor_id, split_part(trim(display_name), ' ', 1) into v_doctor, v_first
    from patients where id = p_patient for update;
  if v_doctor is null then
    raise exception 'patient % not found', p_patient;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a plan needs at least one exercise';
  end if;

  update prescriptions set status = 'replaced' where patient_id = p_patient and status = 'active';

  insert into prescriptions (patient_id, doctor_id, days_per_week, notes)
    values (p_patient, v_doctor, p_days_per_week, nullif(trim(p_notes), ''))
    returning id into v_rx;

  insert into prescription_exercises (prescription_id, position, exercise_id, sets, reps, notes)
  select v_rx, t.ord::int, e.id,
         coalesce((t.item->>'sets')::int, e.default_sets),
         coalesce((t.item->>'reps')::int, e.default_reps),
         nullif(trim(t.item->>'notes'), '')
    from jsonb_array_elements(p_items) with ordinality as t(item, ord)
    join exercises e on e.id = t.item->>'exercise_id';
  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(p_items) then
    raise exception 'unknown exercise in the plan';
  end if;

  select string_agg(format('%s. %s: %s x %s', pe.position, e.name, pe.sets, pe.reps), E'\n' order by pe.position)
    into v_lines
    from prescription_exercises pe join exercises e on e.id = pe.exercise_id
   where pe.prescription_id = v_rx;

  insert into messages (patient_id, direction, kind, body, payload, status)
  values (p_patient, 'out', 'template',
          format(E'Hi %s, your physiotherapist set up your exercise plan, %s days a week:\n%s%s\nTap Start when you are ready.',
                 v_first, p_days_per_week, v_lines,
                 coalesce(E'\nNote from your physiotherapist: ' || nullif(trim(p_notes), ''), '')),
          jsonb_build_object('type', 'new_plan', 'prescription_id', v_rx),
          'queued');
  return v_rx;
end $$;

-- Functions are callable by everyone by default in Postgres. Only the server may prescribe.
revoke all on function prescribe(uuid, jsonb, int, text) from public;


-- patient_overview: one row per patient, with the numbers and the status the dashboard shows.
-- The status rule is deliberately simple and readable, so a doctor can check it:
--   alert       an open alert exists (for example pain reported in WhatsApp)
--   no_plan     no active plan yet
--   new         the plan started less than 3 days ago
--   inactive    no session for 4 days or more
--   stalling    plan at least 14 days old and the knee bend grew by less than 2 degrees week over week
--   on_track    everything else
-- security_invoker: the view obeys the same row level security as the tables (no back door).

create view patient_overview with (security_invoker = true) as
with active_plan as (
  select r.patient_id, r.id as prescription_id, r.days_per_week, r.starts_on,
         (current_date - r.starts_on) as plan_age_days
    from prescriptions r
   where r.status = 'active'
),
session_stats as (
  select s.patient_id,
         count(distinct s.started_at::date) filter (where s.started_at >= now() - interval '7 days')  as days_active_7d,
         avg(s.quality_mean)  filter (where s.started_at >= now() - interval '7 days')                as quality_7d,
         avg(s.quality_mean)  filter (where s.started_at >= now() - interval '14 days'
                                        and s.started_at <  now() - interval '7 days')                as quality_prev_7d,
         avg(s.knee_bend_deg) filter (where s.started_at >= now() - interval '7 days')                as bend_7d,
         avg(s.knee_bend_deg) filter (where s.started_at >= now() - interval '14 days'
                                        and s.started_at <  now() - interval '7 days')                as bend_prev_7d,
         max(s.started_at) as last_session_at,
         count(*)          as sessions_total
    from sessions s
   group by s.patient_id
),
open_alerts as (
  select a.patient_id, count(*) as n, (array_agg(a.detail order by a.created_at desc))[1] as latest
    from alerts a
   where a.resolved_at is null
   group by a.patient_id
),
base as (
  select p.id, p.display_name, p.phone, p.is_simulated, p.condition, p.side, p.doctor_id, p.created_at,
         ap.prescription_id, ap.days_per_week, ap.starts_on, ap.plan_age_days,
         coalesce(ss.days_active_7d, 0)                                     as days_active_7d,
         ss.quality_7d, ss.quality_prev_7d, ss.bend_7d, ss.bend_prev_7d,
         ss.last_session_at, coalesce(ss.sessions_total, 0)                 as sessions_total,
         coalesce(oa.n, 0) as open_alerts, oa.latest as latest_alert,
         -- whole days since the last session (or since the plan started, if there is no session yet)
         coalesce(floor(extract(epoch from now() - ss.last_session_at) / 86400)::int,
                  current_date - ap.starts_on)                                as days_since_activity
    from patients p
    left join active_plan   ap on ap.patient_id = p.id
    left join session_stats ss on ss.patient_id = p.id
    left join open_alerts   oa on oa.patient_id = p.id
),
judged as (
  select b.*,
         case
           when b.open_alerts > 0                                     then 'alert'
           when b.prescription_id is null                             then 'no_plan'
           when b.plan_age_days < 3                                   then 'new'
           when b.days_since_activity >= 4                            then 'inactive'
           when b.plan_age_days >= 14 and b.bend_prev_7d is not null
                and b.bend_7d - b.bend_prev_7d < 2                    then 'stalling'
           else 'on_track'
         end as status
    from base b
)
select j.id, j.display_name, j.phone, j.is_simulated, j.condition, j.side, j.doctor_id, j.created_at,
       j.prescription_id, j.days_per_week, j.starts_on, j.plan_age_days,
       j.days_active_7d::int as days_active_7d,
       least(1.0, j.days_active_7d::numeric / nullif(j.days_per_week, 0))::float8 as adherence_7d,
       round(j.quality_7d * 100)::int      as quality_7d,
       round(j.quality_prev_7d * 100)::int as quality_prev_7d,
       round(j.bend_7d)::int               as bend_7d,
       round(j.bend_prev_7d)::int          as bend_prev_7d,
       j.last_session_at, j.sessions_total::int as sessions_total, j.open_alerts::int as open_alerts,
       j.status,
       case j.status when 'alert' then 1 when 'stalling' then 2 when 'inactive' then 3
                     when 'new' then 4 when 'no_plan' then 5 else 6 end as status_rank,
       case j.status
         when 'alert'    then j.latest_alert
         when 'no_plan'  then 'No exercise plan yet'
         when 'new'      then case j.plan_age_days when 0 then 'Plan started today'
                                                        when 1 then 'Plan started yesterday'
                                                        else format('Plan started %s days ago', j.plan_age_days) end
         when 'inactive' then format('No session for %s days', j.days_since_activity)
         when 'stalling' then format('Knee bend %s° last week, %s° this week',
                                     round(j.bend_prev_7d), round(j.bend_7d))
         else case when j.bend_prev_7d is not null and j.bend_7d is not null
                   then format('Knee bend %s° → %s°', round(j.bend_prev_7d), round(j.bend_7d))
                   else format('%s of %s days this week', j.days_active_7d, j.days_per_week) end
       end as status_reason
  from judged j;

-- On Supabase, also keep the view away from the public API roles. (Those roles do not exist in PGlite.)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on patient_overview from anon, authenticated';
    execute 'revoke all on function prescribe(uuid, jsonb, int, text) from anon, authenticated';
  end if;
end $$;
