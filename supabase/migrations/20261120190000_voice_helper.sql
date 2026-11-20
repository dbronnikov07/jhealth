-- The fast voice helper (a computer run by the team: speech to text and the coach's voice in a tenth of the time
-- our hosted functions need) can announce a public address, so phones use it too. The session page hands that
-- address to the browser while the helper has checked in during the last two minutes; otherwise our own hosted
-- functions are used, as before.
alter table bridge_status add column url text check (url is null or url ~ '^https://[a-z0-9-]+\.trycloudflare\.com$');
