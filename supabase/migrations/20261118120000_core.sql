-- jHealth core schema.
-- Runs on Supabase (Postgres 15+) and on PGlite (Postgres compiled to WebAssembly) for local development.
--
-- Security model: row level security is ON for every table and there are NO policies, so the public
-- "anon" key a browser could hold reads and writes nothing. Only the server, which connects as the
-- database owner, can touch the data. Health data never needs to be readable from a browser directly.

-- ------------------------------------------------------------------ people

create table doctors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  clinic      text,
  is_default  boolean not null default false,   -- new patients are linked to this doctor
  created_at  timestamptz not null default now()
);
create unique index doctors_one_default on doctors ((true)) where is_default;

create table patients (
  id            uuid primary key default gen_random_uuid(),
  doctor_id     uuid not null references doctors(id),
  display_name  text not null check (length(trim(display_name)) > 0),
  phone         text unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),   -- international format, e.g. +14165550123
  is_simulated  boolean not null default false,                     -- demo data, shown with a label
  condition     text not null,
  side          text check (side in ('left', 'right', 'both')),
  language      text not null default 'en',
  created_at    timestamptz not null default now(),
  constraint real_patients_have_a_phone check (is_simulated or phone is not null)
);

-- A patient created without a doctor (for example someone who messages the WhatsApp number for the
-- first time) is linked to the default doctor.
create function set_default_doctor() returns trigger language plpgsql as $$
begin
  if new.doctor_id is null then
    select id into new.doctor_id from doctors where is_default;
    if new.doctor_id is null then
      raise exception 'no default doctor: insert a doctor with is_default = true first';
    end if;
  end if;
  return new;
end $$;

create trigger patients_default_doctor before insert on patients
  for each row execute function set_default_doctor();

-- ------------------------------------------------------------------ exercises

create table exercises (
  id            text primary key check (id ~ '^[a-z0-9_]+$'),
  name          text not null,
  body_area     text not null check (body_area in ('knee', 'hip', 'shoulder', 'other')),
  instructions  text not null,
  tracking      text not null check (tracking in ('camera', 'manual')),  -- camera = reps counted and scored
  model_key     text,                                                    -- which ml/models/<key>.json scores it
  default_sets  int  not null default 2  check (default_sets between 1 and 10),
  default_reps  int  not null default 10 check (default_reps between 1 and 50),
  is_custom     boolean not null default false,
  created_by    uuid references doctors(id),
  created_at    timestamptz not null default now(),
  constraint camera_tracking_needs_a_model check (tracking = 'manual' or model_key is not null)
);

create table exercise_videos (
  id           uuid primary key default gen_random_uuid(),
  exercise_id  text not null references exercises(id) on delete cascade,
  url          text not null,
  source       text not null check (source in ('uploaded', 'generated', 'library')),
  prompt       text,        -- what the doctor asked the video model for
  generator    text,        -- e.g. 'seedance_2_5'
  status       text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  approved_by  uuid references doctors(id),
  approved_at  timestamptz,
  created_at   timestamptz not null default now(),
  -- An AI-generated or uploaded video reaches patients only after a clinician approves it,
  -- and the database refuses an "approved" row that does not say who approved it and when.
  constraint approval_is_recorded check (status <> 'approved' or (approved_by is not null and approved_at is not null)),
  constraint generated_video_keeps_its_prompt check (source <> 'generated' or prompt is not null)
);

-- ------------------------------------------------------------------ plans

create table prescriptions (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references patients(id) on delete cascade,
  doctor_id      uuid not null references doctors(id),
  status         text not null default 'active' check (status in ('active', 'replaced', 'completed', 'cancelled')),
  days_per_week  int  not null default 5 check (days_per_week between 1 and 7),
  starts_on      date not null default current_date,
  notes          text,
  created_at     timestamptz not null default now()
);
-- At most one active plan per patient. A new plan replaces the old one (see prescribe()).
create unique index prescriptions_one_active on prescriptions (patient_id) where status = 'active';

create table prescription_exercises (
  prescription_id  uuid not null references prescriptions(id) on delete cascade,
  position         int  not null check (position between 1 and 20),
  exercise_id      text not null references exercises(id),
  sets             int  not null check (sets between 1 and 10),
  reps             int  not null check (reps between 1 and 50),
  notes            text,
  primary key (prescription_id, position),
  unique (prescription_id, exercise_id)
);

-- ------------------------------------------------------------------ what happened

create table sessions (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references patients(id) on delete cascade,
  prescription_id  uuid references prescriptions(id) on delete set null,
  exercise_id      text not null references exercises(id),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  reps_target      int,
  reps_done        int not null default 0 check (reps_done >= 0),
  quality_mean     numeric(4,3) check (quality_mean between 0 and 1),     -- the model's average rep quality
  knee_bend_deg    numeric(5,1) check (knee_bend_deg between 0 and 180),  -- deepest bend: 180 minus the smallest knee angle
  fault_counts     jsonb not null default '{}',                           -- e.g. {"knees_in": 2}
  source           text not null default 'camera' check (source in ('camera', 'manual')),
  pain_score       int check (pain_score between 0 and 10)
);
create index sessions_patient_time on sessions (patient_id, started_at desc);

create table reps (
  session_id     uuid not null references sessions(id) on delete cascade,
  idx            int  not null check (idx >= 1),
  quality        numeric(4,3) check (quality between 0 and 1),
  fault          text,
  knee_bend_deg  numeric(5,1),
  duration_s     numeric(5,2),
  primary key (session_id, idx)
);

-- ------------------------------------------------------------------ conversation and memory

create table messages (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references patients(id) on delete cascade,
  direction    text not null check (direction in ('in', 'out')),
  channel      text not null default 'whatsapp',
  kind         text not null default 'text' check (kind in ('text', 'template', 'buttons', 'image', 'audio', 'video')),
  body         text,
  payload      jsonb not null default '{}',
  status       text not null check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  provider_id  text unique,                 -- WhatsApp's own message id, used for delivery receipts
  created_at   timestamptz not null default now(),
  constraint direction_matches_status check ((direction = 'in') = (status = 'received'))
);
create index messages_outbox on messages (created_at) where status = 'queued';
create index messages_patient_time on messages (patient_id, created_at desc);

-- What the coach remembers about a patient. Every fact points back to the message it came from,
-- so a doctor can always see WHY the coach believes something.
create table memories (
  id                 uuid primary key default gen_random_uuid(),
  patient_id         uuid not null references patients(id) on delete cascade,
  kind               text not null check (kind in ('pain', 'preference', 'goal', 'barrier', 'history', 'clinical_note')),
  fact               text not null check (length(fact) between 3 and 500),
  source_message_id  uuid references messages(id) on delete set null,
  author             text not null check (author in ('coach', 'doctor')),
  superseded_by      uuid references memories(id),
  created_at         timestamptz not null default now()
);
create index memories_current on memories (patient_id, created_at desc) where superseded_by is null;

create table alerts (
  id                 uuid primary key default gen_random_uuid(),
  patient_id         uuid not null references patients(id) on delete cascade,
  kind               text not null check (kind in ('pain', 'red_flag', 'stalling', 'missed_sessions')),
  detail             text not null,
  source_message_id  uuid references messages(id) on delete set null,
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz,
  resolved_by        uuid references doctors(id)
);
create index alerts_open on alerts (patient_id) where resolved_at is null;

-- ------------------------------------------------------------------ lock everything down

alter table doctors                enable row level security;
alter table patients               enable row level security;
alter table exercises              enable row level security;
alter table exercise_videos        enable row level security;
alter table prescriptions          enable row level security;
alter table prescription_exercises enable row level security;
alter table sessions               enable row level security;
alter table reps                   enable row level security;
alter table messages               enable row level security;
alter table memories               enable row level security;
alter table alerts                 enable row level security;
