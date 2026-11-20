-- The spoken coach also prepares a few personal encouragement lines at the start of a set ("prepare"); they are
-- logged like every other turn, which also keeps them inside the per-patient rate limit.
alter table voice_turns drop constraint voice_turns_event_check;
alter table voice_turns add constraint voice_turns_event_check
  check (event in ('heard', 'start', 'set_done', 'finished', 'prepare'));
