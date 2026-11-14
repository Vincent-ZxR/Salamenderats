-- Obsolete: the shared-passcode API is no longer used. Use accounts.sql instead.
do $$ begin raise exception 'Obsolete migration: run accounts.sql instead'; end $$;
