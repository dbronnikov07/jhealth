-- Check-up visits: the last step of the cycle. The physiotherapist (who decides that a visit is needed) proposes
-- one or two times; the patient taps one in the chat, or asks for a call; the same time then shows on both sides;
-- after the visit the physiotherapist signs the phase off or changes the plan. Motiva only carries the logistics:
-- it never decides that someone needs a visit, and it never confirms a time the clinic did not offer.
create table visits (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references patients(id) on delete cascade,
  doctor_id     uuid references doctors(id),
  status        text not null default 'proposed'
                check (status in ('proposed', 'confirmed', 'call_requested', 'done', 'missed', 'cancelled')),
  options       jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 1 and 2),  -- ISO times offered
  chosen_at     timestamptz,                          -- the time the patient tapped
  reason        text check (reason is null or length(reason) <= 200),
  patient_note  text check (patient_note is null or length(patient_note) <= 500),   -- "mornings don't work, after three is fine"
  created_at    timestamptz not null default now(),
  answered_at   timestamptz,
  closed_at     timestamptz,
  check (status not in ('confirmed', 'done', 'missed') or chosen_at is not null)
);
create index visits_patient on visits (patient_id, created_at desc);
create index visits_open on visits (status) where status in ('proposed', 'confirmed', 'call_requested');
alter table visits enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on visits from anon, authenticated';
  end if;
end $$;
