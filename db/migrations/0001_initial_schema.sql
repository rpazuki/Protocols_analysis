-- 0001_initial_schema.sql
-- Lab Protocols Analysis: initial PostgreSQL schema.
--
-- Design notes:
--  * researcher_email is the app username and is derived from auth claims.
--    It is personal data (docs/privacy-security/gdpr-position.md) and is the
--    only user identity field stored anywhere in this schema.
--  * Reports soft-delete into a recycle bin (deleted_at). Permanent delete
--    removes the row entirely and leaves a row in report_tombstones.
--  * protocol_type_label_snapshot is copied onto the report at save time so a
--    later rename of the protocol type does not rewrite history.

-- The migration runner wraps each file in a transaction; do not add BEGIN/COMMIT here.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- protocol_types: admin-managed dropdown
-- ---------------------------------------------------------------------------
CREATE TABLE protocol_types (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label        text        NOT NULL,
  description  text,
  active       boolean     NOT NULL DEFAULT true,
  sort_order   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT protocol_types_label_not_blank CHECK (btrim(label) <> ''),
  CONSTRAINT protocol_types_label_len CHECK (char_length(label) <= 120)
);

-- Case-insensitive uniqueness so admins cannot create "Western blot" twice.
CREATE UNIQUE INDEX protocol_types_label_unique_idx ON protocol_types (lower(label));
CREATE INDEX protocol_types_ordering_idx ON protocol_types (active, sort_order, lower(label));

CREATE TRIGGER protocol_types_set_updated_at
  BEFORE UPDATE ON protocol_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- protocol_reports
-- ---------------------------------------------------------------------------
CREATE TABLE protocol_reports (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date                  date        NOT NULL,
  researcher_email             text        NOT NULL,
  -- ON DELETE SET NULL: a protocol type should be disabled rather than deleted,
  -- but if one is ever removed the report survives via its label snapshot.
  protocol_type_id             uuid        REFERENCES protocol_types (id) ON DELETE SET NULL,
  protocol_type_label_snapshot text        NOT NULL,
  protocol_name                text        NOT NULL,
  description_text             text        NOT NULL,

  -- Normalization for the exact-duplicate rule, computed in the database so
  -- the unique index cannot drift from the application. Mirrors
  -- normalizeDescription() in packages/domain/src/normalize.ts:
  -- CRLF -> LF, strip trailing whitespace on each line, trim the ends.
  description_normalized text GENERATED ALWAYS AS (
    btrim(
      regexp_replace(
        regexp_replace(description_text, E'\r\n?', E'\n', 'g'),
        E'[ \t]+(\n|$)', E'\\1', 'g'
      ),
      E' \t\n\r'
    )
  ) STORED,

  outcome            text        NOT NULL,
  outcome_hypothesis text,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- Recycle bin
  deleted_at  timestamptz,
  deleted_by  text,
  restored_at timestamptz,
  restored_by text,

  CONSTRAINT protocol_reports_outcome_check CHECK (outcome IN ('success', 'failure')),
  CONSTRAINT protocol_reports_email_lower CHECK (researcher_email = lower(researcher_email)),
  CONSTRAINT protocol_reports_email_shape CHECK (researcher_email LIKE '%_@_%'),
  CONSTRAINT protocol_reports_name_not_blank CHECK (btrim(protocol_name) <> ''),
  CONSTRAINT protocol_reports_description_not_blank CHECK (btrim(description_text) <> ''),
  CONSTRAINT protocol_reports_label_not_blank CHECK (btrim(protocol_type_label_snapshot) <> ''),
  -- deleted_by is recorded whenever a report is in the recycle bin.
  CONSTRAINT protocol_reports_delete_pair CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL) OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL)
  )
);

-- The exact duplicate rule: same researcher, same report date, same normalized
-- main description. Protocol name, type, outcome, and hypothesis are NOT part
-- of the key. Recycled reports still block, per product-overview.md.
-- Descriptions are unbounded free text, so the key hashes the normalized text
-- to stay inside the btree entry size limit.
CREATE UNIQUE INDEX protocol_reports_exact_duplicate_idx
  ON protocol_reports (
    researcher_email,
    report_date,
    digest(description_normalized, 'sha256')
  );

CREATE INDEX protocol_reports_owner_active_idx
  ON protocol_reports (researcher_email, report_date DESC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX protocol_reports_owner_recycled_idx
  ON protocol_reports (researcher_email, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX protocol_reports_all_active_idx
  ON protocol_reports (report_date DESC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX protocol_reports_type_idx ON protocol_reports (protocol_type_id);

-- Admin free-text search across name, description, and hypothesis.
CREATE INDEX protocol_reports_search_idx ON protocol_reports
  USING gin (
    to_tsvector(
      'english',
      protocol_name || ' ' || description_text || ' ' || coalesce(outcome_hypothesis, '')
    )
  );

CREATE TRIGGER protocol_reports_set_updated_at
  BEFORE UPDATE ON protocol_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- report_tombstones: what survives a permanent delete
--
-- Permanent deletion removes the report row and therefore all protocol free
-- text. Only the minimal accountability record below remains, so a lab admin
-- can answer "what happened to report X" without retaining its content.
-- ---------------------------------------------------------------------------
CREATE TABLE report_tombstones (
  report_id               uuid PRIMARY KEY,
  researcher_email        text        NOT NULL,
  report_date             date        NOT NULL,
  created_at              timestamptz NOT NULL,
  deleted_at              timestamptz NOT NULL,
  permanently_deleted_at  timestamptz NOT NULL DEFAULT now(),
  permanently_deleted_by  text        NOT NULL
);

CREATE INDEX report_tombstones_researcher_idx ON report_tombstones (researcher_email, permanently_deleted_at DESC);

-- ---------------------------------------------------------------------------
-- admin_allowlist: runtime-editable admin list, bootstrapped from config
-- ---------------------------------------------------------------------------
CREATE TABLE admin_allowlist (
  email       text PRIMARY KEY,
  added_at    timestamptz NOT NULL DEFAULT now(),
  added_by    text        NOT NULL,
  removed_at  timestamptz,
  removed_by  text,
  -- true for rows seeded from ADMIN_BOOTSTRAP_EMAILS. These cannot be removed
  -- from the UI because deployment config would reinstate them on restart.
  from_config boolean     NOT NULL DEFAULT false,
  CONSTRAINT admin_allowlist_email_lower CHECK (email = lower(email)),
  CONSTRAINT admin_allowlist_email_shape CHECK (email LIKE '%_@_%'),
  CONSTRAINT admin_allowlist_remove_pair CHECK (
    (removed_at IS NULL AND removed_by IS NULL) OR (removed_at IS NOT NULL AND removed_by IS NOT NULL)
  )
);

CREATE INDEX admin_allowlist_active_idx ON admin_allowlist (email) WHERE removed_at IS NULL;

-- ---------------------------------------------------------------------------
-- user_agreement_acceptances
-- ---------------------------------------------------------------------------
CREATE TABLE user_agreement_acceptances (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  researcher_email  text        NOT NULL,
  agreement_version text        NOT NULL,
  accepted_at       timestamptz NOT NULL DEFAULT now(),
  -- Security metadata only (app version, coarse client info). Never profile data.
  accepted_from     text,
  CONSTRAINT user_agreement_email_lower CHECK (researcher_email = lower(researcher_email))
);

CREATE UNIQUE INDEX user_agreement_unique_idx
  ON user_agreement_acceptances (researcher_email, agreement_version);

-- ---------------------------------------------------------------------------
-- audit_events
-- ---------------------------------------------------------------------------
CREATE TABLE audit_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email text        NOT NULL,
  action      text        NOT NULL,
  target_type text        NOT NULL,
  target_id   text,
  metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_actor_lower CHECK (actor_email = lower(actor_email))
);

CREATE INDEX audit_events_created_idx ON audit_events (created_at DESC);
CREATE INDEX audit_events_actor_idx   ON audit_events (actor_email, created_at DESC);
CREATE INDEX audit_events_target_idx  ON audit_events (target_type, target_id, created_at DESC);
CREATE INDEX audit_events_action_idx  ON audit_events (action, created_at DESC);

-- Audit events are append-only *for the application*. This is enforced by
-- privilege in 0002_app_role.sql (the app role gets INSERT and SELECT only)
-- rather than by a rewrite rule, because a DO INSTEAD NOTHING rule would also
-- block the agreed retention pruning and any GDPR erasure work a DBA has to
-- carry out.

