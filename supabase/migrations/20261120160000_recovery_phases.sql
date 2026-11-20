-- Recovery phases and wins.
-- Every patient goes through the same four phases, but what it takes to finish one depends on their operation
-- (web/src/lib/phases.ts). Only the physiotherapist moves a patient on: each move is a sign-off, kept forever.
-- Wins are real-life achievements ("First full turn on an exercise bike"), logged by the patient or the physio.

alter table patients add column phase int not null default 1 check (phase between 1 and 5);  -- 5 = all signed off
alter table patients add column phase_since timestamptz not null default now();

create table phase_signoffs (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references patients(id) on delete cascade,
  from_phase  int not null check (from_phase between 1 and 5),
  to_phase    int not null check (to_phase between 1 and 5),
  doctor_id   uuid references doctors(id),
  note        text check (note is null or length(note) <= 500),
  created_at  timestamptz not null default now(),
  check (to_phase <> from_phase)
);
create index phase_signoffs_patient on phase_signoffs (patient_id, created_at desc);

create table wins (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references patients(id) on delete cascade,
  text        text not null check (length(trim(text)) between 2 and 120),
  author      text not null check (author in ('patient', 'doctor')),
  created_at  timestamptz not null default now()
);
create index wins_patient on wins (patient_id, created_at desc);

alter table phase_signoffs enable row level security;
alter table wins           enable row level security;

-- Demo data: a simulated patient gets the phase their time in rehab suggests, with the sign-offs that got them
-- there and a win or two. Called by seed.sql for new simulated patients, and below for the ones already there.
create function demo_recovery_history(pid uuid) returns void language plpgsql as $$
declare
  started date;
  age     int;
  target  int;
  doc     uuid;
begin
  select r.starts_on into started from prescriptions r where r.patient_id = pid and r.status = 'active';
  if started is null then return; end if;
  age := current_date - started;
  target := case when age >= 28 then 3 when age >= 12 then 2 else 1 end;
  select p.doctor_id into doc from patients p where p.id = pid;

  delete from phase_signoffs where patient_id = pid;
  delete from wins where patient_id = pid;
  for i in 2 .. target loop
    insert into phase_signoffs (patient_id, from_phase, to_phase, doctor_id, created_at)
    values (pid, i - 1, i, doc, (started + (i - 1) * 12)::timestamp + interval '11 hours');
  end loop;
  update patients
     set phase = target,
         phase_since = case when target = 1 then started::timestamp + interval '9 hours'
                            else (started + (target - 1) * 12)::timestamp + interval '11 hours' end
   where id = pid;

  if age >= 5 then
    insert into wins (patient_id, text, author, created_at)
    values (pid, 'Slept through the night', 'patient', (started + 4)::timestamp + interval '8 hours');
  end if;
  if target >= 2 then
    insert into wins (patient_id, text, author, created_at)
    values (pid, 'Walked around the block', 'patient', least(now(), ((started + 15)::timestamp + interval '18 hours')::timestamptz));
  end if;
  if target >= 3 then
    insert into wins (patient_id, text, author, created_at)
    values (pid, 'Walked to the shops', 'patient', least(now(), ((started + 27)::timestamp + interval '12 hours')::timestamptz));
  end if;
end $$;

select demo_recovery_history(id) from patients where is_simulated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on phase_signoffs, wins from anon, authenticated';
    execute 'revoke all on function demo_recovery_history(uuid) from anon, authenticated, public';
  end if;
end $$;
