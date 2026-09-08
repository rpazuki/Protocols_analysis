-- 0002_app_role.sql
-- Least-privilege database role for the application container.
--
-- Migrations run as the owner role; the running app connects as
-- protocols_app, which cannot alter schema, cannot rewrite audit history, and
-- cannot drop tables. Run this after 0001 as the database owner.
--
-- The role password is set out of band (docs/privacy-security/gdpr-position.md
-- keeps credentials out of source control):
--   CREATE ROLE protocols_app LOGIN PASSWORD '...';
-- The DO block below creates the role without a password if it is missing, so
-- local development works; production must set one.

-- The migration runner wraps each file in a transaction; do not add BEGIN/COMMIT here.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'protocols_app') THEN
    CREATE ROLE protocols_app LOGIN;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO protocols_app', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO protocols_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  protocol_types,
  protocol_reports,
  report_tombstones,
  admin_allowlist,
  user_agreement_acceptances
TO protocols_app;

-- Audit events are append-only for the application.
GRANT SELECT, INSERT ON audit_events TO protocols_app;

-- No schema changes from the app role.
REVOKE CREATE ON SCHEMA public FROM protocols_app;

