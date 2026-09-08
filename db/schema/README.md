# Database Schema

Target database: PostgreSQL 16. The schema is created by the files in [`../migrations`](../migrations); this file describes what is there and why.

## Tables

| Table | Purpose |
| --- | --- |
| `protocol_types` | admin-managed dropdown; case-insensitive unique labels |
| `protocol_reports` | the lab record; soft-deletes into the recycle bin via `deleted_at` |
| `report_tombstones` | what survives a permanent delete: ids and timestamps, no protocol text |
| `admin_allowlist` | runtime-editable admin list, bootstrapped from deployment config |
| `researcher_denylist` | addresses refused after successful sign-in; `from_config` pins entries owned by `ACCESS_DENYLIST_EMAILS`; soft-removed so lifted blocks keep their history |
| `user_agreement_acceptances` | one row per user per agreement version |
| `audit_events` | append-only for the application (INSERT and SELECT only for `protocols_app`) |
| `schema_migrations` | applied migrations and their checksums |

## Behaviours enforced in the database

- **Exact duplicates** are blocked by a unique index on `(researcher_email, report_date, sha256(description_normalized))`. `description_normalized` is a generated column implementing the minimal normalization from the product overview. Protocol name, type, outcome, and hypothesis are deliberately outside the key. Active and recycled reports both block; permanently deleted ones cannot, since the rows are gone.
- **Emails are lowercase**, enforced by CHECK constraints on `protocol_reports`, `admin_allowlist`, `user_agreement_acceptances`, and `audit_events`, so one person cannot become two identities through capitalisation.
- **`outcome` is `success` or `failure`**, enforced by a CHECK constraint.
- **A recycled report always records who recycled it** — `deleted_at` and `deleted_by` must be set or unset together.
- **Protocol type labels are snapshotted** onto each report, and the foreign key is `ON DELETE SET NULL`, so a report survives even if its type is ever removed.

## Least privilege

Migrations run as the database owner. The application connects as `protocols_app`, created in `0002_app_role.sql`, which has no schema rights and holds only INSERT and SELECT on `audit_events`. Audit rows are therefore append-only for the app, while a DBA can still carry out agreed retention pruning or a GDPR erasure request.
