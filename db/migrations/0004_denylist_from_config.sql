-- 0004_denylist_from_config.sql
-- Marks which denylist entries come from deployment configuration.
--
-- 0003 inferred the source from `added_by = 'config:bootstrap'`, which is
-- free text an in-app write could also produce, and which cannot represent an
-- entry that was once config-seeded and is no longer listed. Without an
-- explicit marker, an address removed from ACCESS_DENYLIST_EMAILS stayed
-- blocked with its restore button hidden, so a corrected config could not be
-- acted on from the admin page.
--
-- The migration runner wraps each file in a transaction; do not add BEGIN/COMMIT here.

ALTER TABLE researcher_denylist
  ADD COLUMN from_config boolean NOT NULL DEFAULT false;

-- Backfill from the marker 0003 used, so existing config-seeded blocks keep
-- their pinned status across the upgrade.
UPDATE researcher_denylist
   SET from_config = true
 WHERE added_by = 'config:bootstrap'
   AND removed_at IS NULL;

COMMENT ON COLUMN researcher_denylist.from_config IS
  'True while the address is listed in ACCESS_DENYLIST_EMAILS. Such entries are re-asserted on every start and cannot be lifted from the admin page. An address dropped from config keeps its block but becomes an ordinary in-app entry an admin can lift.';
