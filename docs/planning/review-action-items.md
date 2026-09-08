# Review Action Items

This list turns the code review findings into implementation tasks. It excludes the accepted 100,000-character text limit.

> **Implementation status:** all seven items implemented, and the five residual gaps found by the 2026-08-31 review are now closed too — see [Residual Gaps Resolved](#residual-gaps-resolved-2026-08-31) at the end of this file. The original task descriptions are kept below unchanged as the record of what was asked for. What was actually built, and the decisions taken where an item offered a choice, is in [implementation-notes.md](implementation-notes.md).
>
> | # | Item | Outcome |
> | --- | --- | --- |
> | 1 | Researcher access denylist | `researcher_denylist` table, repository, `getPrincipal()` check, `/admin/access` page, `admin-cli.ts access`, `ACCESS_DENYLIST_EMAILS`, 13 security tests |
> | 2 | Mandatory audit events fail closed | `auditRequired()` / `auditBestEffort()` split; every accountability-critical mutation now commits in one transaction with its audit event; 10 tests that force the audit write to fail |
> | 3 | Export cursor cleanup | `settled` flag with an explicit `ROLLBACK` in `finally`; 6 tests asserting against `pg_stat_activity`, verified to fail without the fix |
> | 4 | Blank report filter fields | `blankToUndefined()` plus a single `parseReportFilters()` helper used by every page and the mock API; 7 tests |
> | 5 | Safer export download flow | POST-only, `Origin`-checked route; audit required before any bytes are sent; GET redirects to the export page; 12 tests |
> | 6 | Database-backed tests required in CI | `REQUIRE_TEST_DATABASE` / `CI` turn a skip into a failure; `test:ci` script; GitHub Actions workflow with a PostgreSQL service |
> | 7 | Admin management storage | **Option A.** PostgreSQL accepted as the runtime admin store; product and plan wording updated to "bootstrap config plus runtime database allowlist" |

## 1. Add A Researcher Access Denylist

**Goal:** Keep Imperial SSO broad enough for normal lab access, but block named people who should not be allowed into the app.

**Decision:** Do not add a researcher allowlist. Use a denylist.

**Where:**

- `packages/domain/src/authz.ts`
- `packages/domain/src/admin.ts` or a new `packages/domain/src/access-denylist.ts`
- `packages/db/src/repositories/`
- `db/migrations/`
- `apps/web/src/server/auth/principal.ts`
- `apps/web/src/app/admin/`
- `tests/security/`

**How:**

- Add a `researcher_denylist` PostgreSQL table with normalized email, reason, added timestamp, added by, removed timestamp, and removed by.
- Add repository functions to list, add, and remove denylist entries.
- In `getPrincipal()`, after reading the signed session and before returning a researcher/admin principal, check whether the email is actively denied.
- If denied, redirect page requests to a clear `no access` page and reject server actions.
- Admins should be able to manage the denylist from an admin-only page.
- Denylist changes must be audited.
- Add tests proving that a denied user cannot pass the agreement gate, create reports, view reports, or use mock API endpoints.
- Keep `ALLOWED_EMAIL_DOMAINS` as an optional domain-level safety guard if useful, but do not treat it as lab membership.

## 2. Make Mandatory Audit Events Fail Closed

**Problem:** Some required audit events are written through the fail-open helper in `apps/web/src/server/audit.ts`. That helper swallows failures when no transaction client is supplied.

**Where:**

- `apps/web/src/server/audit.ts`
- `apps/web/src/server/actions/admins.ts`
- `apps/web/src/server/actions/protocol-types.ts`
- `apps/web/src/server/actions/reports.ts`
- `apps/web/src/app/admin/export/download/route.ts`
- `packages/db/src/repositories/admins.ts`
- `packages/db/src/repositories/protocol-types.ts`

**How:**

- Split audit writing into two clearly named paths:
  - `auditBestEffort()` for low-risk telemetry-style events.
  - `auditRequired()` for required accountability events; this must throw on failure.
- Use `auditRequired()` for admin-list changes, protocol-type changes, exports, agreement acceptance, recycle-bin moves, restores, and permanent deletes.
- Wrap admin add/remove and protocol-type create/update in transactions so the mutation and audit event commit together.
- Keep permanent delete transactional; it already writes the deletion and audit event together in `apps/web/src/server/actions/reports.ts`.
- For exports, write the audit event before streaming and refuse the export if the audit write fails.
- Add tests that simulate audit failure and confirm required operations do not silently succeed.

## 3. Clean Up Export Cursor Transactions On Cancelled Downloads

**Problem:** `streamReportsForExport()` starts a PostgreSQL transaction and declares a cursor. If the browser cancels the download before the generator is exhausted, the client can be released without a commit or rollback.

**Where:**

- `packages/db/src/repositories/reports.ts`

**How:**

- Add a `committed` or `finished` flag inside `streamReportsForExport()`.
- Set it only after the cursor has been fully consumed and `COMMIT` succeeds.
- In `finally`, if the flag is false, run `ROLLBACK` before releasing the client.
- Optionally close the cursor explicitly before commit for readability.
- Add a unit/integration test that consumes only the first export batch, stops iteration, and verifies the connection can be reused cleanly.

## 4. Parse Blank Report Filter Fields As Empty Filters

**Problem:** The report filter form submits blank strings for empty fields, but `reportFilterSchema` treats blank strings as invalid dates, UUIDs, and enum values. A normal filter submission can therefore produce a server error.

**Where:**

- `packages/domain/src/protocol-report.ts`
- `apps/web/src/app/reports/page.tsx`
- `apps/web/src/app/reports/recycle-bin/page.tsx`
- `apps/web/src/app/admin/reports/page.tsx`
- `apps/web/src/app/admin/recycle-bin/page.tsx`
- `apps/mock-api/src/server.ts`
- `tests/unit/validation.test.ts`

**How:**

- Add a reusable blank-to-undefined preprocessor for optional filter fields.
- Apply it to `from`, `to`, `protocolTypeId`, `researcherEmail`, `outcome`, `q`, and `state` where appropriate.
- Alternatively, add a `parseReportFiltersFromSearchParams()` helper in the domain package and make every page/API use that helper.
- Add tests for `{ from: '', to: '', protocolTypeId: '', outcome: '', q: '' }`.
- Keep export parsing as a reference: `apps/web/src/app/admin/export/download/route.ts` already normalizes blank query values before parsing.

## 5. Replace Sensitive Export GET With A Safer Download Flow

**Problem:** Export generation currently uses a GET route. Because exports contain raw email addresses and protocol text, a download should require an intentional same-origin action.

**Where:**

- `apps/web/src/app/admin/export/page.tsx`
- `apps/web/src/app/admin/export/download/route.ts`
- `apps/web/src/server/actions/`
- `packages/domain/src/export-schema.ts`
- `tests/security/`

**How:**

- Replace the GET-only export form with either:
  - a POST route that checks `Origin`/`Host`, validates form data, audits, and streams the file; or
  - a server action that validates filters, writes a short-lived export ticket, then redirects to a ticketed download route.
- Keep the current streaming implementation, max-row check, CSV injection guard, and `includeRecycled` default.
- Make audit required before any export bytes are sent.
- Add tests that a non-admin cannot export and that export requests without a valid same-origin flow are rejected.

## 6. Require Database-Backed Tests In CI

**Problem:** Integration and DB-backed security tests skip when `TEST_DATABASE_URL` is missing. That is convenient locally, but unsafe for CI because the strongest guarantees can accidentally go untested.

**Where:**

- `tests/helpers/db.ts`
- `package.json`
- future CI workflow file
- `infra/local/docker-compose.yml`

**How:**

- Add a CI-specific script such as `test:integration:required` and `test:security:required`.
- Make `tests/helpers/db.ts` throw instead of skip when `CI=true` or `REQUIRE_TEST_DATABASE=true`.
- Start a throwaway PostgreSQL service in CI and set `TEST_DATABASE_URL`.
- Keep the current skip behaviour for ordinary local runs.
- Add README instructions showing the required CI command.

## 7. Decide Whether Admin Management Must Literally Edit Config

**Problem:** The implementation stores the runtime-editable admin list in PostgreSQL, while the earlier product wording said admins should edit config on a running app.

**Where:**

- `docs/admin-ops/admin-management.md`
- `docs/planning/product-overview.md`
- `packages/db/src/repositories/admins.ts`
- `apps/web/src/app/admin/admins/page.tsx`
- `apps/web/src/server/actions/admins.ts`

**How:**

- Option A: accept PostgreSQL as the runtime admin store and update product wording to say "bootstrap config plus runtime database allowlist."
- Option B: implement literal mounted-config editing with file locking, validation, backup, rollback, and VM recovery documentation.
- If Option A is accepted, keep the current bootstrap-admin recovery path through `ADMIN_BOOTSTRAP_EMAILS`.
- If Option B is required, treat it as security-sensitive infrastructure work and add tests for concurrent edits, corrupted config recovery, and last-admin protection.

## Latest Evaluation 2026-08-31

The latest implementation satisfies the main web-app shape of the action list, but it does not fully satisfy the checklist across configuration recovery, CLI operations, and export-origin hardening.

### Status Rollup

| Item | Evaluation |
| --- | --- |
| 1. Researcher access denylist | Mostly satisfied, with a config-reconciliation problem. |
| 2. Mandatory audit events fail closed | Satisfied for the main web actions, but not for all VM-level CLI admin changes. |
| 3. Export cursor cleanup | Satisfied. |
| 4. Blank report filter fields | Satisfied. |
| 5. Safer export download flow | Mostly satisfied in the web UI, with origin-check and CLI export gaps. |
| 6. Database-backed tests required in CI | Satisfied. |
| 7. Admin management storage decision | Satisfied; Option A was chosen and documented. |

### Remaining Problems

1. **Config-seeded denylist blocks can become stuck.**

   **Problem:** `ACCESS_DENYLIST_EMAILS` is reconciled into `researcher_denylist`, but the table has no explicit `from_config` column and `syncConfigDenylist()` only inserts or re-activates listed emails. If an email is removed from deployment config, the active database block is not automatically lifted. The admin page also hides the restore button for rows whose `added_by` is `config:bootstrap`, so a stale config-seeded block can remain active even after the config was corrected.

   **Where:** `packages/db/src/repositories/denylist.ts`, `db/migrations/0003_researcher_denylist.sql`, `apps/web/src/app/admin/access/page.tsx`, `tests/security/access-denylist.test.ts`.

   **How:** Add an explicit source marker such as `from_config boolean NOT NULL DEFAULT false`, make `syncConfigDenylist()` mark current config entries and lift or convert entries no longer present in config, and update the admin page so restore availability follows the real source state rather than `added_by` text. Add tests for config add, config removal, in-app restore, and restart reconciliation.

2. **VM admin CLI add/remove can still leave unaudited admin-list changes.**

   **Problem:** The web admin actions wrap the mutation and audit event in one transaction, but `scripts/admin/admin-cli.ts add` and `remove` write the admin change first and the audit event second. If the audit insert fails, the admin grant or removal persists without the required accountability event.

   **Where:** `scripts/admin/admin-cli.ts`, especially the `add()` and `remove()` functions; add coverage in `tests/integration/audit-fail-closed.test.ts` or a dedicated CLI integration test.

   **How:** Wrap `adminsRepo.addAdmin()` / `adminsRepo.removeAdmin()` and `auditRepo.recordAuditEvent()` in `withTransaction()`, matching the existing `access block` and `access unblock` CLI paths. If the audit write fails, the admin mutation must roll back.

3. **Export CLI writes the file before the export audit event exists.**

   **Problem:** The web export route records `export.run` before streaming bytes, but `scripts/export/export-cli.ts` streams the file first and writes audit afterward. If the audit write fails, the export file already exists. The CLI also counts rows but does not enforce the web app's `EXPORT_MAX_ROWS` limit.

   **Where:** `scripts/export/export-cli.ts`, `scripts/export/README.md`, `docs/data-export/export-plan.md`.

   **How:** Parse the same max-row setting used by the web app, refuse oversized exports before opening the output file, and write the required audit event before any export bytes are written. The audit metadata can record the requested filters and pre-counted row total; if the later file write fails, that is still an audited attempted export rather than an unaudited data release.

4. **The export same-origin check trusts forwarded host headers too broadly.**

   **Problem:** `isSameOriginRequest()` compares the request `Origin` host with `x-forwarded-host` if present. If the reverse proxy does not strip or overwrite client-supplied `X-Forwarded-Host`, a caller can spoof that header and make a foreign origin pass the helper. The helper also compares hosts rather than full origins, so `http://protocols.lab.example.ac.uk` can match a secure production host by name alone.

   **Where:** `apps/web/src/server/same-origin.ts`, `tests/security/export-origin.test.ts`, deployment proxy documentation.

   **How:** Prefer comparing the full `Origin` origin to configured `APP_URL`. Only trust forwarded host/proto headers if deployment guarantees the proxy overwrites them, and document that requirement. Add tests for spoofed `X-Forwarded-Host` and scheme mismatch.

5. **Some docs and comments now overstate parity.**

   **Problem:** The main export page is POST-only in code, but its comment still says the form GETs the download route. Several docs also say the mock API and CLI apply the same export/audit rules as the app, while the CLI and mock API still use GET-style export surfaces and direct `auditRepo.recordAuditEvent()` calls.

   **Where:** `apps/web/src/app/admin/export/page.tsx`, `apps/mock-api/src/server.ts`, `apps/mock-api/README.md`, `scripts/export/README.md`, `docs/data-export/export-plan.md`.

   **How:** Update comments and docs after the behavioral fixes above. If the mock API intentionally remains looser because it is development-only, say that explicitly instead of describing it as identical to the production web route.

### Verification Run

- `npm test` passed: 85 unit tests.
- `npm run typecheck` passed across all workspaces.
- `npm run build` passed.
- `npm run test:integration` and `npm run test:security` skipped database-backed suites locally because `TEST_DATABASE_URL` was not set.
- `npm run test:integration:required` and `npm run test:security:required` failed fast without `TEST_DATABASE_URL`, which confirms the CI guard works.
- `.github/workflows/ci.yml` provides PostgreSQL and sets `REQUIRE_TEST_DATABASE=true`, so CI should exercise the database-backed tests rather than skipping them.


## Residual Gaps Resolved 2026-08-31

All five problems from the evaluation above are fixed. Each fix was checked by reverting it and confirming the new tests fail without it, so none of them pass vacuously.

| # | Problem | Resolution |
| --- | --- | --- |
| 1 | Config-seeded denylist blocks could become stuck | `0004_denylist_from_config.sql` adds an explicit `from_config` column, backfilled from the old `added_by` marker. `syncConfigDenylist()` now runs on every start including with an empty list, marks current config entries, and demotes entries config no longer lists. The admin page gates its restore button on `entry.fromConfig` rather than free text, and shows the source in a column. 9 new tests. |
| 2 | CLI admin add/remove could leave unaudited changes | `add()` and `remove()` in `admin-cli.ts` now wrap the mutation and its audit event in `withTransaction()`, matching the `access block`/`unblock` paths. `tests/integration/cli-audit.test.ts` runs the real script against a database whose `audit_events` rejects every insert and asserts each change rolls back. |
| 3 | Export CLI wrote the file before auditing, and ignored the row cap | The CLI now enforces `EXPORT_MAX_ROWS` before touching the filesystem and writes the `export.run` event before opening the output file. A later write failure leaves an audited attempt rather than an unaudited release. |
| 4 | Origin check trusted forwarded headers and compared hosts | `isSameOriginRequest()` compares the full `Origin` — scheme, host, and port — against `APP_URL` plus `ALLOWED_ORIGINS`, and consults no forwarded headers at all. Proxied deployments still work, because the browser sends the public origin even when the proxy rewrites `Host`. 16 tests, including spoofed `X-Forwarded-Host` and scheme mismatch. |
| 5 | Docs and comments overstated parity | The export page comment now describes the POST flow and why. `apps/mock-api/README.md` has a table stating exactly where the mock API is looser (header identity, GET export, non-transactional audit) and that this is safe only because it refuses to run in production. `scripts/export/README.md` and the export plan state what the CLI does and does not share with the web route. |

### Decision Taken

Item 1 offered "lift or convert" for an address dropped from `ACCESS_DENYLIST_EMAILS`. **Converting was chosen.** Auto-lifting would mean that editing a config file silently restores someone's access with nobody deciding to; converting keeps the block in force and hands control to the admins, whose restore button now works. This is the same principle `syncConfigAdmins()` already applied in the other direction — an admin dropped from config keeps their access rather than being silently revoked — so a config edit never quietly changes who has access, either way.

### Verification

- 85 unit, 62 integration, 70 security = **217 tests**, all passing against PostgreSQL 16.
- `npm run typecheck` and `npm run build` clean.
- Reverting the item 1, 2, and 4 fixes each makes the corresponding new tests fail.
