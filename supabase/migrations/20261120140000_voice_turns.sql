-- The spoken conversation during a camera session: what the patient said out loud (or which moment it was: the
-- start, the end of a set, the end of the session) and what the voice coach answered. The physiotherapist can read
-- it, and it limits how often one patient link can ask for an answer (each one costs an AI reply and speech).
create table voice_turns (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references patients(id) on delete cascade,
  event       text not null check (event in ('heard', 'start', 'set_done', 'finished')),
  exercise_id text references exercises(id),
  heard       text check (heard is null or char_length(heard) <= 400),
  reply       text not null check (char_length(reply) <= 600),
  created_at  timestamptz not null default now()
);
create index voice_turns_recent on voice_turns (patient_id, created_at desc);
alter table voice_turns enable row level security;
