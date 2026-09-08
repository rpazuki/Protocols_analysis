# Mock API

Development-only JSON API. It refuses to start with `NODE_ENV=production`.

The web app talks to PostgreSQL directly, so this service is **not** on the UI's request path. It exists for the case the scaffold anticipated: building and testing other clients — scripts, analysis notebooks, a future CLI — against a stable surface before Imperial ICT approves real SSO.

```bash
npm run dev:mock-api      # http://localhost:4000
```

## Authenticating

Identity is asserted with a request header, which is the same trust boundary the real adapters implement — a client written against this API needs no changes when real SSO lands, only the header goes away.

```bash
curl -H 'x-mock-persona: researcher' http://localhost:4000/me
curl -H 'x-mock-email: someone@ic.ac.uk' http://localhost:4000/reports
```

Personas: `researcher`, `researcher2`, `admin`. `GET /personas` lists them.

## Routes

| Route | Notes |
| --- | --- |
| `GET /health` | agreement and export schema versions |
| `GET /personas` | available mock identities |
| `POST /agreement/accept` | required before any other authenticated route |
| `GET /me` | resolved principal, including whether the allowlist makes them an admin |
| `GET /protocol-types` | `?includeInactive=true` |
| `GET /reports` | owner-scoped; admins may add `?all=true` |
| `GET /reports/:id` | 404 for another researcher's report |
| `POST /reports` | 409 on an exact duplicate |
| `GET /export` | admin only, audited |

## What it shares with the web app, and where it is looser

It reuses `@protocols/domain` and `@protocols/db`, so the **data rules are identical**: ownership scoping, the researcher access denylist, the agreement gate, admin-only export, and the exact-duplicate rule all behave exactly as they do in the web app. A blocked address gets a 403 here too, so a client built against this API cannot reach data the UI would refuse.

It is deliberately looser in three ways, all of which are safe only because it never runs in production (it exits on `NODE_ENV=production`):

| | Web app | Mock API |
| --- | --- | --- |
| Identity | Signed session cookie from an SSO adapter | A request header naming a persona |
| Export | POST only, origin-checked, streamed | `GET /export`, returns JSON in one response |
| Audit | Required events roll their mutation back if the audit write fails | Writes audit events directly; a failure surfaces as a 500 rather than rolling the change back |

If you need to exercise the production export path — the origin check, the streaming, the fail-closed audit — use the web route, not this.
