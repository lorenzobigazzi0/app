-- Bootstrap DB permissions for the application role.
--
-- Usage (example):
--   psql -U postgres -d cassa -f backend/scripts/db_bootstrap.sql -v app_user=cassa
--
-- Default user if not provided: cassa
\if :{?app_user}
\else
\set app_user cassa
\endif

-- Ensure the role can use the database and create objects in schema public.
GRANT CONNECT ON DATABASE cassa TO :app_user;
GRANT USAGE, CREATE ON SCHEMA public TO :app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO :app_user;

-- Optional (helps when Postgres 15+ has tightened public schema defaults)
-- Allow extensions/types created by the app if needed:
-- GRANT CREATE ON DATABASE cassa TO :app_user;
