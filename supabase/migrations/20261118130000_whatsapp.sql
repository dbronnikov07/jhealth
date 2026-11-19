-- WhatsApp: who a patient is on WhatsApp, the link they open, and what happened to every message.

-- WhatsApp users who adopt a username can arrive without a phone number, identified only by a
-- business-scoped user ID (BSUID, for example US.13491208655302741918). Store it when we see it.
alter table patients add column whatsapp_user_id text unique;

-- The secret part of the patient's session link (https://.../s/<token>). 64 hex characters,
-- about 244 random bits. Each existing patient gets its own value.
alter table patients add column session_token text not null unique
  default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

alter table patients drop constraint real_patients_have_a_phone;
alter table patients add constraint real_patients_are_reachable
  check (is_simulated or phone is not null or whatsapp_user_id is not null);

alter table messages add column attempts   int not null default 0;
alter table messages add column claimed_at timestamptz;
alter table messages add column sent_at    timestamptz;
alter table messages add column error_code text;          -- WhatsApp's error code, e.g. 131047
alter table messages add column error      text;          -- what the dashboard shows the doctor
alter table messages drop constraint messages_status_check;
alter table messages add constraint messages_status_check
  check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'received'));


-- claim_outbox(): the sender takes queued messages and marks them 'sending' in one step, so two senders
-- (two browser tabs, a retry, a webhook) never send the same message twice. A message stuck in
-- 'sending' for 2 minutes (the sender crashed) is taken again, at most 5 attempts in total.
create function claim_outbox(p_patient uuid default null, p_limit int default 20)
returns setof messages language sql as $$
  update messages set status = 'sending', attempts = attempts + 1, claimed_at = now()
   where id in (
     select id from messages
      where direction = 'out'
        and attempts < 5
        and (status = 'queued' or (status = 'sending' and claimed_at < now() - interval '2 minutes'))
        and (p_patient is null or patient_id = p_patient)
      order by created_at
      limit p_limit
      for update skip locked)
  returning *;
$$;


-- apply_message_status(): WhatsApp reports sent / delivered / read separately, sometimes twice and
-- sometimes out of order. A message only ever moves forward (a late 'delivered' never undoes 'read').
create function apply_message_status(p_provider_id text, p_status text, p_error_code text default null, p_error text default null)
returns boolean language plpgsql as $$
declare
  v_new int := case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'played' then 3 else 0 end;
  v_count int;
begin
  if p_status = 'failed' then
    update messages set status = 'failed', error_code = p_error_code, error = p_error
     where provider_id = p_provider_id and direction = 'out' and status in ('sending', 'sent');
  elsif v_new > 0 then
    update messages set status = case when p_status = 'played' then 'read' else p_status end
     where provider_id = p_provider_id and direction = 'out'
       and v_new > case status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end
       and status <> 'failed';
  end if;
  get diagnostics v_count = row_count;
  return v_count > 0;
end $$;


-- requeue_after_reply(): WhatsApp only allows free-form messages within 24 hours of the patient's last
-- message (error 131047 outside that window). When the patient writes again, the window is open:
-- put those messages back in the queue.
create function requeue_after_reply(p_patient uuid)
returns int language sql as $$
  with r as (
    update messages set status = 'queued', error_code = null, error = null, attempts = 0
     where patient_id = p_patient and direction = 'out' and status = 'failed' and error_code = '131047'
    returning 1)
  select count(*)::int from r;
$$;


revoke all on function claim_outbox(uuid, int) from public;
revoke all on function apply_message_status(text, text, text, text) from public;
revoke all on function requeue_after_reply(uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function claim_outbox(uuid, int) from anon, authenticated';
    execute 'revoke all on function apply_message_status(text, text, text, text) from anon, authenticated';
    execute 'revoke all on function requeue_after_reply(uuid) from anon, authenticated';
  end if;
end $$;
