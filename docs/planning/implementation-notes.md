# Implementation Notes

Decisions taken while turning [project-plan.md](project-plan.md) into working code, and the places where the implementation makes a choice the plan left open.

## Stack choices

**Next.js App Router with server actions.** The plan asks for "CSRF protection or same-site server actions for mutations", and the scaffolded `.gitignore` already listed `.next/`. Server actions are same-origin checked by the framework, so every mutation gets that protection without a hand-rolled token scheme. `output: 'standalone'` produces a bundle that runs under plain `node` in Docker, with no package manager or managed service, which is what the Red Hat VM target needs.

**No ORM.** The two rules that matter most — the exact-duplicate key and the state constraints — are expressed as a unique index and CHECK constraints. Hand-written SQL keeps them visible to anyone reviewing `db/migrations/0001_initial_schema.sql`, including reviewers who do not read TypeScript.

**A `packages/db` workspace, which the scaffold did not name.** The web app and the operational scripts both need the same queries, and duplicating the ownership-scoping logic between them would be the obvious way to end up with a scoping bug in one of them.

## The exact-duplicate rule

The plan is emphatic that the rule is exact, not fuzzy, and that it compares only researcher, report date, and main description.

The rule lives in the database:

```sql
CREATE UNIQUE INDEX protocol_reports_exact_duplicate_idx
  ON protocol_reports (researcher_email, report_date, digest(description_normalized, 'sha256'));
```

`description_normalized` is a generated column. Its SQL mirrors `normalizeDescription()` in `packages/domain/src/normalize.ts`: CRLF to LF, strip trailing whitespace per line, trim the ends. Two consequences worth knowing:

- The application-level check in the server action exists only to produce a friendly message with a link to the blocking report. If it ever disagrees with the database, the unique violation is caught and converted into the same domain error, so the database always wins.
- Descriptions are unbounded, so the index hashes the normalized text rather than indexing it directly, which would exceed the btree entry size limit on a long protocol description.

Recycled reports still block, per the product overview. Permanently deleted ones do not, because their rows are gone.

## Permanent delete

Permanent deletion removes the `protocol_reports` row outright rather than setting a flag, so the protocol free text genuinely leaves the database. What remains is a `report_tombstones` row (id, researcher, report date, timestamps, who deleted it) and an audit event. The delete, the tombstone, and the audit event share one transaction: an untraceable permanent deletion would defeat the accountability requirement in the privacy notes.

## Access: a denylist, not an allowlist

Imperial SSO authenticates the whole institution, which is wider than lab membership. Two ways to close that gap were available, and the lab chose the denylist.

An allowlist would be the tighter default, but it puts an admin action in front of every new lab member's first protocol record, and it fails in the direction of locking people out silently as it drifts. A denylist keeps sign-in frictionless and makes exclusion an explicit, audited decision about a named person. The trade-off is real and worth stating: anyone Imperial authenticates can create reports until someone blocks them, so `ALLOWED_EMAIL_DOMAINS` is worth setting as a domain-level guard, and the denylist is not a substitute for offboarding.

Details that matter:

- The check runs in `getPrincipal()` on **every** request, next to the admin lookup, so a block takes effect on the blocked user's next page load rather than when their session expires.
- Refusal happens *after* authentication succeeds. The blocked person is told this app withdrew their access, not that their login failed, so nobody spends an afternoon with the ICT service desk over an access-control decision.
- The reason recorded on an entry is shown to admins only. It is an access-control note for whoever reviews the decision later, not a message the app delivers to the blocked person.
- Blocking does not delete reports. The lab record is evidence and survives the author losing access.
- An admin cannot be blocked while still an admin, and cannot block themselves. Denying an admin would strip access while leaving them on the allowlist, so the two lists would disagree about who has access; remove them as an admin first, and the change is visible and audited as what it is.
- `ACCESS_DENYLIST_EMAILS` applies a block from deployment config, for the case where someone must be shut out and no admin session is available. While an address is listed there it is *pinned*: re-asserted on every start, and not liftable from the admin page, because config would reinstate it anyway.
- An address **removed** from config is demoted to an ordinary in-app entry rather than unblocked. Auto-lifting would mean tidying a config file silently restores someone's access with nobody deciding to; demoting keeps the block in force and hands control to the admins, whose restore button now works. This matches how `syncConfigAdmins()` treats an admin dropped from config: a config edit never silently changes who has access, in either direction. An explicit `from_config` column carries this state, rather than inferring it from `added_by` free text.
- The mock API enforces the same denylist, so a client built against it cannot reach data the UI refuses.

## Audit: required versus best-effort

Audit writing is split into two named paths rather than one helper with a `client` parameter, because the choice between them is a policy decision.

`auditRequired()` throws. Every accountability-critical change — admin-list edits, access blocks, protocol-type changes, report create/update/recycle/restore/purge, agreement acceptance, exports — runs inside a transaction with its audit event, so the mutation and the record of it commit or roll back together. The alternative, writing the row and then failing to audit it, produces exactly the change nobody can account for.

`auditBestEffort()` logs and swallows. It is used for logins and denied-access attempts, where dropping a row is better than failing a user's request.

`tests/integration/audit-fail-closed.test.ts` forces the audit INSERT to fail inside each transaction and asserts the mutation is rolled back with it. `tests/integration/cli-audit.test.ts` does the same for the VM-level CLI by running the real script against a database whose `audit_events` table rejects every insert — the break-glass path is used precisely when things are already going wrong, so it needs the guarantee most.

The export CLI writes its audit event before opening the output file, for the same reason the web route writes one before its first byte: a file on disk is a release of the lab record, and `EXPORT_MAX_ROWS` is enforced there too.

## Exports are POST-only

Producing an export releases raw email addresses and the full text of every matching report. A GET route can be triggered by a link, an image tag, a prefetch, or a URL pasted into another tab — none of which the admin meant as "release the lab record" — so the route is POST and checks the request origin before doing any work, the same check Next applies to server actions. A GET redirects to the export page rather than producing a file.

The check compares the browser's `Origin` in full — scheme, host, and port — against `APP_URL` plus `ALLOWED_ORIGINS`. An earlier version compared it against `X-Forwarded-Host`, which is wrong twice over: the header is attacker-controllable unless the proxy is known to overwrite it, and comparing host names alone would let `http://host` match an `https` deployment. Neither forwarded header is consulted now, and nothing is lost by that — behind a proxy the browser still sends the public origin, which is exactly what `APP_URL` names.

The audit event is written before the first byte is sent, and an export that cannot be audited is refused outright: an export that failed halfway still means data left the database.

## Authorization

Three rules that are easy to get subtly wrong, so they are stated explicitly:

- **Admins can view, recycle, restore, and permanently delete any report, but cannot edit another researcher's report content.** An admin rewriting someone else's record would break attribution, which is the point of storing the email address at all.
- **Ownership scoping happens in the repository, not the page.** `listReports(filter, ownerEmail)` applies the scope on top of the caller's filter, so passing another researcher's address as a filter cannot widen a scoped view. There is a security test for exactly this.
- **Role is never carried in the session cookie.** It is read from the admin allowlist on every request, so removing an admin takes effect on their next page load rather than when their session expires.

## Authentication boundary

`packages/auth-adapters/core` defines the whole trust boundary: an adapter returns an `AuthClaims` with a normalized email, a subject, and an issuer, and nothing else the identity provider released is carried into the app.

- **Mock** renders a persona picker. It cannot run in production: `config.ts` throws at module load, the adapter constructor throws, `readSession()` refuses to honour a mock session, and the persona route 404s. There is a security test that boots the config module in a production environment and asserts the refusal.
- **Entra ID / OIDC** is a full authorization-code flow with PKCE, discovery, and `id_token` signature verification against the tenant JWKS. Nothing activates until ICT supplies issuer, client id, and secret.
- **Shibboleth / SAML** is implemented in service-provider proxy mode: a Shibboleth SP in front of the app terminates SAML and releases attributes as request headers. The app never parses XML or holds the SP signing key, which is how Imperial ICT normally expects an SP to be deployed. Because header-based identity is only safe behind that SP, the adapter requires a shared secret header (`SHIBBOLETH_PROXY_SECRET`) that the proxy injects, and rejects any request that lacks it or lacks an SP session. Bind the container to loopback so only the SP can reach it.

If ICT requires the app itself to speak SAML, that is a new adapter behind the same interface; nothing outside `packages/auth-adapters` changes.

## Export streaming and cancelled downloads

`streamReportsForExport()` holds a transaction and a server-side cursor open for the life of the download. A browser that cancels part-way through simply stops consuming the async generator, so the `finally` block runs without the loop ever reaching COMMIT. Releasing the client there would return it to the pool still inside a transaction, holding a snapshot open — and the next export on that connection would fail on a cursor name that already exists.

A `settled` flag distinguishes the two cases: set only after COMMIT succeeds, checked in `finally` to roll back otherwise. `tests/integration/export-streaming.test.ts` abandons a stream after one batch and asserts against `pg_stat_activity` that nothing is left idle in transaction.

## Choices the plan left open

| Decision | Implemented as | How to change it |
| --- | --- | --- |
| Recycled records in exports | Excluded by default; admin opt-in per export | UI checkbox / `--include-recycled` |
| Researcher restores own reports | Allowed | `ALLOW_RESEARCHER_RESTORE=false` |
| Researcher permanently deletes own reports | Allowed | `ALLOW_RESEARCHER_PERMANENT_DELETE=false` |
| Waiting period before permanent delete | None | `PERMANENT_DELETE_WAIT_DAYS=30` |
| Retention / auto-purge | None implemented | Deliberate: no rule should be applied before the lab agrees one |

## Deliberate omissions

- **No automatic retention or purge job.** Deleting lab records on a schedule nobody has agreed to would be worse than keeping them. When a retention period is decided, it belongs in a scheduled script that writes audit events.
- **No tombstone export.** The export plan lists `permanently_deleted_at` as a possible field, but a permanently deleted report has no content left to export. The tombstones are visible through `admin-cli.ts check` and the audit trail.
- **No fuzzy duplicate detection**, no file attachments, no multi-lab tenancy — all explicit non-goals.

## Verification performed

Against a real PostgreSQL 16, 217 tests:

- 85 unit tests: normalization, duplicate key, dates, authorization policy, admin guards, denylist guards, filter parsing, export serialization, validation.
- 62 integration tests: repository behaviour, duplicate rule, recycle-bin lifecycle, filtering, export streaming and cursor cleanup, fail-closed audit for both the web actions and the VM CLI, admin allowlist, agreement acceptance, audit.
- 70 security tests: cross-researcher isolation, denylist enforcement and config reconciliation, admin-only capabilities, export same-origin requirement including header spoofing and scheme mismatch, database-level constraints, SQL-injection handling, production config refusals, forged Shibboleth header rejection.

Every fix for a reported defect was checked against the un-fixed code first, to confirm its tests fail without it rather than passing vacuously: the export cursor cleanup, the fail-closed audit, the CLI audit transaction, and the denylist config reconciliation.

Manually walked through in a browser: mock sign-in, agreement gate, report creation, duplicate block, create-from-previous, cross-researcher 404, admin-only redirect, admin all-reports view, blocking and restoring access, a blocked user being refused on every route including the agreement gate, blank-filter submission, CSV and JSONL export via POST, GET-to-export redirecting instead of producing a file, cross-origin export refused, and the audit trail.
