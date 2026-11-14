-- Obsolete: the former schema made all maps public. Use accounts.sql instead.
do $$ begin raise exception 'Obsolete schema: run accounts.sql instead'; end $$;
