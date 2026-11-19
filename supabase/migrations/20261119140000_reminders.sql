-- Daily reminders: when each patient wants them (hour of the day, Toronto time) and whether they want them at all.
-- The coach can learn a preference ("mornings are better") and the physiotherapist can change it.
alter table patients add column if not exists reminder_hour int not null default 18 check (reminder_hour between 0 and 23);
alter table patients add column if not exists reminders_enabled boolean not null default true;
