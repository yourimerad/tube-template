-- Accent-insensitive search ("electricite" finds "Électricité").
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() is only STABLE; an IMMUTABLE wrapper with an explicit dictionary is the standard trick
-- so it can be used in expressions/indexes.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
