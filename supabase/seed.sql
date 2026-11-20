-- Demo data for Motiva Health. Safe to run more than once.
--
-- Real:       one demo doctor and the exercise library.
-- SIMULATED:  20 patients with a few weeks of sessions, messages and memories. They are marked
--             is_simulated = true and the dashboard labels them. They exist so the dashboard has a
--             realistic population; the patient you add with your own phone number is the real one.
--
-- The random numbers are seeded, so every run produces the same patients.

insert into doctors (id, name, clinic, is_default)
values ('00000000-0000-4000-8000-0000000000d1', 'Dr. Demo, PT', 'Motiva Health demo clinic', true)
on conflict (id) do update set clinic = excluded.clinic;

-- Instructions are draft wording for the demo. A physiotherapist should review them before real use.
insert into exercises (id, name, body_area, instructions, tracking, model_key, default_sets, default_reps) values
  ('sit_to_stand', 'Sit-to-stand', 'knee',
   'Sit near the front of a sturdy chair, feet flat and hip-width apart. Lean forward a little and stand up fully, then sit back down slowly. Use your hands only if your physiotherapist said so.',
   'camera', 'sit_to_stand', 2, 10),
  ('seated_knee_extension', 'Seated knee extension', 'knee',
   'Sit tall on a chair, side-on to the camera. Slowly straighten one knee until the leg is level with the floor, hold for 2 seconds, then lower it slowly.',
   'manual', null, 2, 10),
  ('squat', 'Chair squat', 'knee',
   'Stand in front of a sturdy chair, feet hip-width apart. Bend your knees and sit back as if to sit down, only as far as is comfortable, then stand up tall. Keep your knees in line with your toes.',
   'camera', 'squat', 2, 10),
  ('arm_raise', 'Arm raise to the side', 'shoulder',
   'Stand or sit tall. Keep your arm straight and lift it out to the side up to shoulder height, then lower it slowly. Keep your body still.',
   'camera', 'arm_raise', 2, 10),
  ('seated_knee_flexion', 'Seated knee flexion', 'knee',
   'Sit on a chair. Slide your foot back under the chair to bend the knee as far as is comfortable, hold for 2 seconds, then slide it forward again.',
   'manual', null, 2, 10)
on conflict (id) do nothing;

select setseed(0.42);

do $$
declare
  i          int;
  d          int;
  pid        uuid;
  rx         uuid;
  msg        uuid;
  profile    text;
  plan_days  int;
  start_day  date;
  bend       numeric;
  q          numeric;
  t          timestamptz;
  conditions text[] := array['Total knee replacement', 'Knee osteoarthritis', 'ACL reconstruction',
                             'Total knee replacement', 'Total hip replacement'];
begin
  if exists (select 1 from patients where is_simulated) then
    return;                                        -- already seeded
  end if;

  for i in 1..20 loop
    -- Most patients improve steadily. A few are set up to show each dashboard state:
    --   06 and 13 stall (knee bend stops improving), 17 stopped exercising a week ago,
    --   20 got the plan yesterday, 09 reported pain in WhatsApp.
    profile := case when i in (6, 13) then 'stalling'
                    when i = 17      then 'inactive'
                    when i = 20      then 'new'
                    else 'steady' end;
    plan_days := case when profile = 'new' then 1 else 15 + (i * 7) % 22 end;    -- 15 to 36 days ago
    start_day := current_date - plan_days;

    insert into patients (display_name, is_simulated, condition, side, created_at)
    values (format('Simulated patient %s', lpad(i::text, 2, '0')), true, conditions[1 + i % 5],
            case when i % 3 = 0 then 'left' else 'right' end, start_day - 1)
    returning id into pid;

    insert into prescriptions (patient_id, doctor_id, days_per_week, starts_on, created_at)
    select pid, p.doctor_id, 5, start_day, start_day from patients p where p.id = pid
    returning id into rx;

    insert into prescription_exercises (prescription_id, position, exercise_id, sets, reps) values
      (rx, 1, 'sit_to_stand', 2, 10),
      (rx, 2, 'seated_knee_extension', 2, 10),
      (rx, 3, 'seated_knee_flexion', 2, 10);

    bend := 70 + random() * 15;          -- deepest knee bend at the start, degrees
    q    := 0.45 + random() * 0.15;      -- average rep quality at the start, 0 to 1

    for d in 0 .. plan_days - 1 loop
      continue when profile = 'inactive' and d > plan_days - 7;
      continue when random() > case when profile = 'stalling' then 0.6 else 0.82 end;   -- missed days

      if profile = 'stalling' and d > plan_days - 15 then
        bend := bend + random() * 0.3 - 0.15;          -- no real progress in the last two weeks
      else
        bend := bend + 0.6 + random() * 0.8;           -- about +1 degree per session
      end if;
      q := least(0.9, q + 0.004 + random() * 0.01);

      t := (start_day + d)::timestamp + interval '17 hours' + random() * interval '4 hours';
      insert into sessions (patient_id, prescription_id, exercise_id, started_at, ended_at,
                            reps_target, reps_done, quality_mean, knee_bend_deg, source)
      values (pid, rx, 'sit_to_stand', t, t + interval '7 minutes',
              20, 16 + floor(random() * 5)::int,
              round((q + (random() - 0.5) * 0.06)::numeric, 3),
              round(least(130, bend + (random() - 0.5) * 3)::numeric, 1),
              'camera');
    end loop;

    -- Where they are in their recovery: phases signed off so far, and a win or two.
    perform demo_recovery_history(pid);

    -- A little conversation history and memory, so the patient pages are not empty.
    if i = 9 then
      insert into messages (patient_id, direction, kind, body, status, created_at)
      values (pid, 'in', 'text', 'my knee hurts a lot today, like 7 out of 10, after yesterday', 'received',
              now() - interval '3 hours')
      returning id into msg;
      insert into alerts (patient_id, kind, detail, source_message_id, created_at)
      values (pid, 'pain', 'Reported knee pain 7/10 after yesterday''s session', msg, now() - interval '3 hours');
      insert into memories (patient_id, kind, fact, source_message_id, author, created_at)
      values (pid, 'pain', 'Knee pain 7/10 the day after a session', msg, 'coach', now() - interval '3 hours');
    elsif i = 6 then
      insert into messages (patient_id, direction, kind, body, status, created_at)
      values (pid, 'in', 'text', 'evenings are hard, I''m too tired after work. mornings would be better', 'received',
              now() - interval '5 days')
      returning id into msg;
      insert into memories (patient_id, kind, fact, source_message_id, author, created_at)
      values (pid, 'preference', 'Prefers morning sessions; too tired in the evening after work', msg, 'coach',
              now() - interval '5 days');
    elsif i = 13 then
      insert into messages (patient_id, direction, kind, body, status, created_at)
      values (pid, 'in', 'text', 'I want to be able to walk my dog around the block again', 'received',
              now() - interval '12 days')
      returning id into msg;
      insert into memories (patient_id, kind, fact, source_message_id, author, created_at)
      values (pid, 'goal', 'Wants to walk the dog around the block again', msg, 'coach', now() - interval '12 days');
    end if;
  end loop;
end $$;
