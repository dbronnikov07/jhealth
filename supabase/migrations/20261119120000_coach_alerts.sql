-- The AI coach can ask the physiotherapist to look at a chat (a symptom it noticed, a question only they can
-- answer, a request to change the plan). Those alerts get their own kind so the dashboard can say where they
-- came from. The coach can add alerts; nothing it does can remove one.
alter table alerts drop constraint alerts_kind_check;
alter table alerts add constraint alerts_kind_check
  check (kind in ('pain', 'red_flag', 'stalling', 'missed_sessions', 'coach'));
