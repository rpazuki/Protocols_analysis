# Export Plan

Exports are for lab-admin review and downstream LLM analysis of protocol success/failure patterns.

## Formats

- CSV for spreadsheet review.
- JSONL for LLM and batch-analysis pipelines.

## Default Fields

- schema_version
- report_id
- report_date
- researcher_email
- protocol_type_id
- protocol_type_label_snapshot
- protocol_name
- description_text
- outcome
- outcome_hypothesis
- created_at
- updated_at
- deleted_at
- restored_at
- permanently_deleted_at, if tombstone metadata is retained

## Filters

- date range;
- researcher email;
- protocol type;
- outcome;
- include/exclude recycle-bin records;
- text search, if implemented.

## Security

- Exports include raw researcher email addresses by current requirement.
- Export actions must be admin-only.
- Export actions must be audited.
- Export files should not be left indefinitely on disk unless explicitly configured.
- If exports are shared outside the lab, revisit pseudonymisation/anonymisation and governance first.
- Decide whether recycle-bin records are excluded by default, included only by explicit admin selection, or never exported.

## Operational Export CLI

`scripts/export/export-cli.ts` produces the same files for scheduled or scripted runs on the VM. It matches the web route on filters, the recycled-records default, `EXPORT_MAX_ROWS`, and audit-before-release: the `export.run` event is written before the output file is opened, and the export is abandoned if that write fails.

It has no origin check, because no browser is involved. Access control there is the VM's: anyone who can run the script already holds the database credentials.

## As Implemented

Both formats are available from the admin UI (`/admin/export`) and from [`scripts/export/export-cli.ts`](../../scripts/export/README.md).

**Fields.** As listed above, with two deliberate differences:

- `permanently_deleted_at` is **not** an export field. A permanently deleted report has no content left to export; only a tombstone and an audit event remain, visible through `admin-cli.ts check` and the audit page.
- `record_state` (`active` or `recycled`) is added, so an analysis pipeline does not have to infer state from a null `deleted_at`.

Every record carries `schema_version` (currently `1.0.0`), so downstream analysis can branch on it.

**Filters.** Date range, researcher email, protocol type, outcome, full-text search, and include/exclude recycled — all implemented.

**Recycle-bin records are excluded by default** and included only when an admin explicitly ticks the box (or passes `--include-recycled`). This resolves the open question at the end of this document; it is the conservative reading, since a recycled report is one its researcher chose to delete.

**Security, as implemented:**

- **POST only, and same-origin checked.** An export releases raw email addresses and the full text of every matching report, so it must be a deliberate submit from the export page. A GET route could be triggered by a link, an image tag, a prefetch, or a URL pasted into another tab — none of which an admin meant as "release the lab record". A GET to the download endpoint redirects to the export page instead of producing a file.
- The origin check compares the browser's `Origin` against `APP_URL` and `ALLOWED_ORIGINS` in full — scheme, host, and port. It deliberately ignores `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto`: those are attacker-controllable unless the reverse proxy is known to overwrite them, and the app cannot verify that from inside. A proxied deployment still works without them, because the browser sends the public origin even when the proxy rewrites `Host`.
- Admin-only, checked server-side in the route handler, not just hidden in the UI.
- Every export writes an `audit_events` row **before the stream starts, and the export is refused outright if that write fails** — an export that fails halfway still means data left the database, and an unrecorded one would defeat the accountability requirement. The event records the filters, the row count, and the format, but no report text.
- A blocked account (see the researcher access denylist) is refused here with a 403 rather than redirected, because this endpoint returns a file.
- `EXPORT_MAX_ROWS` (default 100,000) refuses an oversized export, so one click cannot pull the whole lab record by accident.
- CSV values beginning `=`, `+`, `-`, or `@` are prefixed with an apostrophe. Protocol free text is user-controlled and these files are opened in spreadsheets.
- CSV is written with a UTF-8 BOM so Excel renders protocol text correctly.
- Exports stream from a server-side cursor, so a large export does not buffer the lab record in the app container's memory. A cancelled download rolls the cursor's transaction back explicitly, so an abandoned export cannot return a connection to the pool holding a snapshot open.
- Nothing is written to disk by the web app; the file streams to the browser. The CLI writes where told, defaulting to `storage/local-dev/`, which is git-ignored.
