-- 0003_researcher_denylist.sql
-- Blocks named individuals from using the app.
--
-- Imperial SSO authenticates the whole institution, which is broader than lab
-- membership. Rather than maintaining a researcher allowlist - which would add
-- an onboarding step for every new lab member and would silently lock people
-- out when it drifted - access is open to anyone the identity provider
-- authenticates (subject to ALLOWED_EMAIL_DOMAINS) except people named here.
--
-- Entries are soft-removed so the record of who was denied, by whom, and why
-- survives being lifted.

-- The migration runner wraps each file in a transaction; do not add BEGIN/COMMIT here.

CREATE TABLE researcher_denylist (
  email       text PRIMARY KEY,
  -- Why access was blocked. Shown only to admins, never to the denied user.
  reason      text,
  added_at    timestamptz NOT NULL DEFAULT now(),
  added_by    text        NOT NULL,
  removed_at  timestamptz,
  removed_by  text,
  CONSTRAINT researcher_denylist_email_lower CHECK (email = lower(email)),
  CONSTRAINT researcher_denylist_email_shape CHECK (email LIKE '%_@_%'),
  CONSTRAINT researcher_denylist_reason_len CHECK (reason IS NULL OR char_length(reason) <= 500),
  CONSTRAINT researcher_denylist_remove_pair CHECK (
    (removed_at IS NULL AND removed_by IS NULL) OR (removed_at IS NOT NULL AND removed_by IS NOT NULL)
  )
);

-- Every authenticated request checks this, so keep the active lookup cheap.
CREATE INDEX researcher_denylist_active_idx ON researcher_denylist (email) WHERE removed_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON researcher_denylist TO protocols_app;
