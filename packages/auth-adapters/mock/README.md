# Mock Auth Adapter

Development-only authentication. Selected with `AUTH_ADAPTER=mock`.

It renders a persona picker at `/auth/mock` and mints a session for the chosen identity. Mock users are labelled in the UI (a `MOCK USER` badge in the header) and in audit events.

Three preset personas plus an arbitrary-address form, which is the quickest way to check that one researcher cannot see another's reports.

## Production guards

Four independent refusals, because a mock session in production would let anyone assert any identity:

1. `apps/web/src/server/config.ts` throws at module load if `NODE_ENV=production` and `AUTH_ADAPTER=mock`.
2. `getAuthAdapter()` throws rather than constructing this adapter in production.
3. `readSession()` refuses to honour a session carrying `isMock` in production, even if a cookie secret leaked between environments.
4. `/auth/mock` returns 404 unless this adapter is selected.

`tests/security/auth-boundaries.test.ts` boots the config module in a production environment and asserts the first of these.
