-- Development seed: bootstrap admin allowlist entry.
-- DEVELOPMENT ONLY. Production bootstraps admins from ADMIN_BOOTSTRAP_EMAILS
-- in deployment config, not from a seed file.
INSERT INTO admin_allowlist (email, added_by, from_config)
VALUES ('mock.admin@ic.ac.uk', 'seed:development', true)
ON CONFLICT (email) DO NOTHING;
