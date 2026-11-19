-- The demo phone: a stand-in for WhatsApp, for when Meta's WhatsApp account is unavailable (for example on stage).
-- A patient on the 'demo' channel chats on a page of our own site (/s/<token>/phone) instead of WhatsApp. Their
-- messages go through exactly the same code (pain rule, quick replies, AI coach, outbox); only the last step differs:
-- the outbox hands the message to the demo phone instead of calling Meta.
alter table patients add column channel text not null default 'whatsapp'
  check (channel in ('whatsapp', 'demo'));

-- Every message records the channel it went through (messages.channel exists since the first migration).
create function set_message_channel() returns trigger language plpgsql as $$
begin
  new.channel := coalesce((select channel from patients where id = new.patient_id), new.channel);
  return new;
end $$;

create trigger messages_channel before insert on messages
  for each row execute function set_message_channel();

revoke all on function set_message_channel() from public;
