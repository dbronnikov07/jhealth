-- A plan message that never reached the patient becomes wrong as soon as the doctor saves a newer plan.
-- Found in testing: an old, unsent plan message was sent first and would have been re-sent after the
-- patient's next reply. Now saving a plan cancels earlier unsent plan messages, so a patient never
-- receives an outdated plan.

alter table messages drop constraint messages_status_check;
alter table messages add constraint messages_status_check
  check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'cancelled', 'received'));

-- One-time clean-up of rows written before this fix.
update messages m
   set status = 'cancelled', error = 'Not sent: replaced by a newer plan'
 where m.direction = 'out' and m.status in ('queued', 'failed') and m.payload->>'type' = 'new_plan'
   and exists (select 1 from messages n
                where n.patient_id = m.patient_id and n.payload->>'type' = 'new_plan' and n.created_at > m.created_at);

create or replace function prescribe(p_patient uuid, p_items jsonb, p_days_per_week int default 5, p_notes text default null)
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

  -- New in this version: earlier plan messages that never went out are cancelled.
  update messages set status = 'cancelled', error = 'Not sent: replaced by a newer plan'
   where patient_id = p_patient and direction = 'out' and status in ('queued', 'failed')
     and payload->>'type' = 'new_plan';

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

revoke all on function prescribe(uuid, jsonb, int, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function prescribe(uuid, jsonb, int, text) from anon, authenticated';
  end if;
end $$;
