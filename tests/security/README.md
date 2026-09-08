# Security Tests

```bash
TEST_DATABASE_URL=postgres://localhost/protocols_test npm run test:security
```

Skips itself when `TEST_DATABASE_URL` is unset. The database is truncated between tests, so point it at a throwaway database.

Every check the scaffold called for, and where it lives:

| Check | File |
| --- | --- |
| A researcher cannot read another researcher's reports | `authorization.test.ts` |
| A researcher cannot edit or delete another researcher's reports | `authorization.test.ts` |
| An admin cannot edit another researcher's report content either | `authorization.test.ts` |
| A researcher cannot restore or permanently delete another's recycled reports | `authorization.test.ts` |
| An explicit filter cannot widen an owner-scoped listing | `authorization.test.ts` |
| Non-admins cannot export or reach admin capabilities | `authorization.test.ts` |
| Duplicates are blocked only on researcher + date + normalized description | `authorization.test.ts`, `../integration/reports.test.ts` |
| The duplicate rule holds against raw SQL, not just the app | `authorization.test.ts` |
| Free text and search input are treated as data, never as SQL | `authorization.test.ts` |
| The SQL normalization matches the TypeScript normalizer | `authorization.test.ts` |
| Agreement acceptance is required before use | `../integration/admins-and-agreement.test.ts` |
| A blocked researcher is refused everywhere, including the agreement gate | `access-denylist.test.ts` |
| Blocking does not delete the person's reports | `access-denylist.test.ts` |
| An admin cannot be blocked without first losing admin rights | `access-denylist.test.ts` |
| A lifted block keeps the record of the original denial | `access-denylist.test.ts` |
| Exports require a same-origin POST | `export-origin.test.ts` |
| A spoofed `X-Forwarded-Host` cannot pass the origin check | `export-origin.test.ts` |
| A plaintext origin cannot match an https deployment | `export-origin.test.ts` |
| A config-dropped block stays in force but becomes liftable | `access-denylist.test.ts` |
| Required audit events fail closed | `../integration/audit-fail-closed.test.ts` |
| Mock auth cannot run in production | `auth-boundaries.test.ts` |
| Production refuses a weak secret, an http URL, or no bootstrap admin | `auth-boundaries.test.ts` |
| Forged Shibboleth attribute headers are rejected | `auth-boundaries.test.ts` |
| Identity is never taken from untrusted input | `auth-boundaries.test.ts`, `../unit/validation.test.ts` |

## Running in CI

`REQUIRE_TEST_DATABASE=true` (or `CI=true`) turns a missing `TEST_DATABASE_URL` into a hard failure instead of a skip, because a CI run that skipped this suite would report green while testing none of these guarantees:

```bash
npm run test:security:required
```

## Not covered here

CSRF protection on server actions is provided by Next.js, which same-origin checks them, together with `SameSite=Lax` session cookies. That is framework behaviour rather than application logic, so it is verified by configuration review (`next.config.ts`, `apps/web/src/server/auth/session.ts`) rather than by a test here. The export route is *not* a server action, so its equivalent check is application code and is tested in `export-origin.test.ts`.

An end-to-end browser suite in `tests/e2e` would be the right place to assert the server-action check directly.
