# Lab Protocols Analysis

Internal one-lab web app for recording daily protocol variations and outcomes, and exporting them for later analysis.

Product behaviour is defined by [product-overview.md](docs/planning/product-overview.md); the architecture plan is in [project-plan.md](docs/planning/project-plan.md). This README covers running and operating the implementation.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Web app | Next.js 16 App Router, React 19, TypeScript | Server actions give same-origin CSRF protection for every mutation; `output: standalone` produces a self-contained bundle for Docker on the VM. |
| Database | PostgreSQL 16, `pg`, hand-written SQL migrations | No ORM, so the exact-duplicate unique index and the CHECK constraints stay readable and reviewable. |
| Auth | Provider-adapter boundary | Mock in development, Entra ID/OIDC or Shibboleth/SAML in production, selected by one environment variable. |
| Hosting | Docker Compose | No managed cloud services, so the same image runs on the Imperial Red Hat VM. |

## Layout

```
apps/web                  Next.js researcher and admin UI, server actions, export route
apps/mock-api             Development-only JSON API for building clients before SSO approval
packages/domain           Validation, normalization, duplicate rule, authorization policy, export schema
packages/db               Connection pool, repositories, migration runner
packages/auth-adapters/   core (interface) + mock, entra-oidc, shibboleth-saml
db/migrations             PostgreSQL schema, applied in filename order
db/seeds                  Development seed data (never run in production)
scripts/db                Migration and seed runners
scripts/admin             Break-glass admin recovery CLI
scripts/export            Operational CSV/JSONL export CLI
infra/docker              Production Dockerfile
infra/local               Local development compose stack
infra/environments        Per-environment notes and the production compose file
tests/                    unit, integration, security
```

## Running it locally

Requires Node 22+ and Docker (or any PostgreSQL 16 you point `DATABASE_URL` at).

```bash
npm install
cp .env.example .env
docker compose -f infra/local/docker-compose.yml up -d
npm run db:migrate
npm run db:seed
npm run dev
```

Then open http://localhost:3000. Mock sign-in offers three personas:

| Persona | Email | Role |
| --- | --- | --- |
| MOCK Researcher | `mock.researcher@ic.ac.uk` | researcher, has seeded reports |
| MOCK Second Researcher | `mock.colleague@ic.ac.uk` | researcher, has not accepted the agreement yet |
| MOCK Lab Admin | `mock.admin@ic.ac.uk` | admin |

You can also sign in as any other address to check that researchers cannot see each other's reports.

The optional mock API runs separately:

```bash
npm run dev:mock-api
```

## Tests

```bash
npm test                  # unit tests, no database needed
npm run test:integration  # needs TEST_DATABASE_URL
npm run test:security     # needs TEST_DATABASE_URL
```

The database-backed suites skip themselves when `TEST_DATABASE_URL` is unset. Point it at a throwaway database — they truncate every table between tests.

```bash
createdb protocols_test
TEST_DATABASE_URL=postgres://localhost/protocols_test npm run test:integration
```

**In CI, skipping is not allowed.** The exact-duplicate unique index, the CHECK constraints, and cross-researcher isolation only exist against a real database, so a run that quietly skipped them would report green while testing none of them. `REQUIRE_TEST_DATABASE=true` (or `CI=true`) turns a missing `TEST_DATABASE_URL` into a hard failure:

```bash
npm run test:ci
```

That runs typecheck, unit tests, and both database-backed suites with the database required. [.github/workflows/ci.yml](.github/workflows/ci.yml) starts a PostgreSQL service and runs exactly that, then builds the app and the production image.

## How the rules are enforced

- **Identity** comes from the authenticated session only. `researcherEmail` is not a form field anywhere, and the input schema rejects it if supplied.
- **Access** is open to everyone Imperial authenticates, minus a denylist. There is deliberately no researcher allowlist: SSO is the membership check, and gating every new lab member on an admin action would leave someone waiting to record their first protocol. Admins block named individuals from `/admin/access`; the check runs on every request, so a block takes effect immediately, and the blocked person is told the *app* withdrew access rather than being left thinking their Imperial login is broken.
- **The exact-duplicate rule** is a unique index on `(researcher_email, report_date, sha256(description_normalized))`. `description_normalized` is a generated column whose SQL mirrors `normalizeDescription()` in `packages/domain`, so raw SQL, a background job, and the UI cannot disagree. A whitespace-only variation collides; a different date, wording, or researcher does not; protocol name, type, outcome, and hypothesis are outside the key.
- **Ownership** is applied in the repository, not the page: `listReports(filter, ownerEmail)` scopes the query, and an explicit `researcherEmail` filter cannot widen it.
- **Admin status** is read from the database allowlist on every request, never from the session cookie, so removing an admin takes effect immediately.
- **The agreement gate** runs in `requirePrincipal()`, which every authenticated page and server action calls.
- **Protocol type labels** are snapshotted onto each report at save time, and an edit keeps the original snapshot unless the researcher changes the type.
- **Permanent delete** removes the report row entirely; only a `report_tombstones` row and an audit event remain, and they commit in the same transaction.
- **Required audit events fail closed.** Accountability-critical changes — admin-list edits, access blocks, protocol-type changes, report writes, recycle/restore/purge, agreement acceptance, exports — commit in one transaction with their audit event, so the app can never report success for a change nobody can later account for. Login and denied-access events are best-effort, where losing a row beats failing the request.
- **Exports are POST-only and same-origin checked.** An export releases raw email addresses and the full text of every matching report, so it must be a deliberate submit from the export page; a link, prefetch, image tag, or bookmarked URL cannot produce one. The check compares the browser's `Origin` in full — scheme, host, and port — against `APP_URL` and `ALLOWED_ORIGINS`, and ignores `X-Forwarded-Host`, which a client can set. The audit event is written before any bytes are sent, and an export that cannot be audited is refused. The export CLI applies the same row limit and audits before opening its output file.
- **Mock auth** cannot run in production: `config.ts` refuses to load, and the adapter refuses to construct.

## Deployment

Build and run on the VM:

```bash
docker compose -f infra/environments/production/docker-compose.yml --env-file /etc/protocols-analysis/app.env build
docker compose -f infra/environments/production/docker-compose.yml --env-file /etc/protocols-analysis/app.env up -d
docker compose -f infra/environments/production/docker-compose.yml --env-file /etc/protocols-analysis/app.env \
  run --rm --entrypoint node app scripts/db/migrate.ts
```

Migrations are run explicitly on deploy, never automatically at boot, so a rolling restart cannot silently change the schema.

Before first production start, `ADMIN_BOOTSTRAP_EMAILS` must name at least one admin, `SESSION_SECRET` must be at least 32 characters, and `APP_URL` must be `https://` — the app refuses to start otherwise.

### Operations

```bash
node scripts/admin/admin-cli.ts check           # connectivity and record counts
node scripts/admin/admin-cli.ts list            # admin allowlist
node scripts/admin/admin-cli.ts add name@ic.ac.uk    # break-glass
node scripts/admin/admin-cli.ts audit --action=export.run
node scripts/export/export-cli.ts --format=jsonl --from=2026-01-01
```

Exports contain raw Imperial email addresses. See [gdpr-position.md](docs/privacy-security/gdpr-position.md).

## Before real lab data

Still outstanding, and not code decisions:

1. Retention periods for active reports, recycle-bin reports, tombstones, audit events, backups, and exports.
2. Sign-off on the privacy notice and agreement wording (lab PI, department, ICT, Imperial data protection contact).
3. Imperial ICT approval of either the Entra ID app registration or the Shibboleth SP, and the resulting claim/attribute names.
4. Backup and restore procedure for the database and the admin allowlist together.

The app-level choices those decisions interact with are configurable rather than hard-coded: see `ALLOW_RESEARCHER_RESTORE`, `ALLOW_RESEARCHER_PERMANENT_DELETE`, and `PERMANENT_DELETE_WAIT_DAYS` in [.env.example](.env.example).

## Production without SSO

Set `AUTH_ADAPTER=local` for email/password login with provisioned accounts.
Production HTTPS/session-secret requirements still apply; `mock` remains blocked.
The **Users** page lets local admins create/reset/disable/reactivate accounts and
manage roles. New/reset users change their temporary password before accessing
reports; signed-in users can change their own password from the header.
See [local account operations and deployment](docs/admin-ops/local-authentication.md).
The production Compose host port is configurable with `APP_HOST_PORT` (default
3200) so this app can share a machine with BioPipeline2.

For a fresh native installation beside BioPipeline2 on a server with PostgreSQL
and nginx already installed, follow the [Red Hat installation guide](docs/fresh_install_linux_redhat.md).
