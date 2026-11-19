-- iMessage: patients who text jHealth's iMessage address. Messages travel through a small bridge on a Mac signed into
-- jHealth's own Apple ID (web/scripts/imessage-bridge.mjs): it posts incoming texts to the server and collects queued
-- replies from it. The Mac only ever connects out to the server; nothing on it is reachable from the internet.
alter table patients add column imessage_handle text unique;   -- the patient's iMessage address: +14165550123 or a@b.com

alter table patients drop constraint patients_channel_check;
alter table patients add constraint patients_channel_check check (channel in ('whatsapp', 'demo', 'imessage'));

alter table patients drop constraint real_patients_are_reachable;
alter table patients add constraint real_patients_are_reachable
  check (is_simulated or phone is not null or whatsapp_user_id is not null or imessage_handle is not null);

-- Each sender takes only its own channel's messages: the WhatsApp/demo outbox never touches iMessage rows, and the
-- bridge never touches WhatsApp ones. Same rules as claim_outbox(): one claimer per message, retried after 2 minutes,
-- at most 5 attempts.
create function claim_outbox_channels(p_channels text[], p_patient uuid default null, p_limit int default 20)
returns setof messages language sql as $$
  update messages set status = 'sending', attempts = attempts + 1, claimed_at = now()
   where id in (
     select m.id from messages m join patients p on p.id = m.patient_id
      where m.direction = 'out'
        and m.attempts < 5
        and (m.status = 'queued' or (m.status = 'sending' and m.claimed_at < now() - interval '2 minutes'))
        and p.channel = any(p_channels)
        and (p_patient is null or m.patient_id = p_patient)
      order by m.created_at
      limit p_limit
      for update of m skip locked)
  returning *;
$$;
revoke all on function claim_outbox_channels(text[], uuid, int) from public;

-- iMessage only answers people who wrote first (cold messages get Apple IDs flagged). A message held back for that
-- reason is marked error_code 'window' and goes out as soon as the patient writes, like WhatsApp's 131047.
create or replace function requeue_after_reply(p_patient uuid)
returns int language sql as $$
  with r as (
    update messages set status = 'queued', error_code = null, error = null, attempts = 0
     where patient_id = p_patient and direction = 'out' and status = 'failed' and error_code in ('131047', 'window')
    returning 1)
  select count(*)::int from r;
$$;
revoke all on function requeue_after_reply(uuid) from public;

-- When each bridge last checked in, for the dashboard's "iMessage connected" badge.
create table bridge_status (
  name       text primary key,
  last_seen  timestamptz not null default now()
);
alter table bridge_status enable row level security;
