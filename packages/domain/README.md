# Domain Package

Shared rules, with no database or framework dependencies. The web app, the mock API, the operational scripts, and the tests all import from here, so a rule cannot drift between them.

| Module | Contents |
| --- | --- |
| `outcome.ts` | the success/failure enum |
| `normalize.ts` | description, email, and label normalization — the reference implementation of the duplicate-rule normalization, mirrored by a generated column in SQL |
| `dates.ts` | report dates as `YYYY-MM-DD` strings, and "today" in the lab's timezone |
| `protocol-report.ts` | report shape, input validation, the duplicate key, filters, and `parseReportFilters()` — the single place blank filter fields are turned into "no filter" |
| `protocol-type.ts` | protocol type shape and validation |
| `agreement.ts` | agreement version, text, and acceptance shape |
| `audit.ts` | audit actions, targets, and metadata sanitization |
| `admin.ts` | allowlist shape and the last-admin / config-admin guards |
| `access-denylist.ts` | denylist shape and the guards that stop an admin being blocked |
| `authz.ts` | the authorization policy: who may view, edit, recycle, restore, and permanently delete |
| `export-schema.ts` | export schema version, field list, CSV and JSONL serialization |
| `errors.ts` | typed domain errors |

Two things to keep in step when editing:

- `normalizeDescription()` and the `description_normalized` generated column in `db/migrations/0001_initial_schema.sql`. A security test asserts they agree.
- `AGREEMENT_VERSION` and the agreement text. Bumping the version re-prompts every user, which is the point.
