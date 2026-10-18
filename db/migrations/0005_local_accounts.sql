-- Optional password accounts. Identity/role ownership remains email-based.
CREATE TABLE local_accounts (
  email text PRIMARY KEY CHECK (email = lower(trim(email)) AND position('@' in email) > 1),
  password_hash text NOT NULL,
  credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  is_active boolean NOT NULL DEFAULT true,
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON local_accounts TO protocols_app;
-- Account creation/reset/deactivation requires the owner via the operational CLI.
GRANT UPDATE (failed_login_count, locked_until, last_login_at) ON local_accounts TO protocols_app;
