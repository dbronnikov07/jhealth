-- Belt and braces for the hosted database. Supabase publishes every table, view and function in the `public`
-- schema through its automatic web API, reachable with the project's public (anon) key. Row level security with
-- no policies already returns nothing there; this also takes the permissions away, so the web API answers
-- "permission denied" for every table, view and function, now and for anything created later.
-- The app itself connects as the database owner and is not affected. On a local database (no Supabase roles)
-- this does nothing.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon, authenticated';
    execute 'revoke all on all sequences in schema public from anon, authenticated';
    execute 'revoke all on all functions in schema public from anon, authenticated, public';
    execute 'alter default privileges in schema public revoke all on tables from anon, authenticated';
    execute 'alter default privileges in schema public revoke all on sequences from anon, authenticated';
    execute 'alter default privileges in schema public revoke all on functions from anon, authenticated, public';
  end if;
end $$;
