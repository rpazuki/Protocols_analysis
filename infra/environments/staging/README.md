# Staging Environment

Staging mirrors production and differs from it in exactly three ways: a separate database, an `ENVIRONMENT_LABEL` banner, and ICT's test SSO integration rather than the live one.

Use the production compose file with a staging env file:

```bash
docker compose -f infra/environments/production/docker-compose.yml \
  --env-file /etc/protocols-analysis/staging.env up -d
```

Settings that must differ from production:

| Variable | Staging value |
| --- | --- |
| `ENVIRONMENT_LABEL` | `STAGING` — renders a banner on every page so nobody mistakes it for the lab record |
| `DATABASE_URL` | a separate database, never the production one |
| `APP_URL` | the staging hostname |
| `ENTRA_*` / `SHIBBOLETH_*` | ICT's test integration |
| `ADMIN_BOOTSTRAP_EMAILS` | whoever is testing |

Still true in staging: `NODE_ENV=production`, so mock auth is refused, `SESSION_SECRET` must be at least 32 characters, and `APP_URL` must be `https://`.

Seed staging with `npm run db:seed` only if it holds no real data — the seed script refuses to run under `NODE_ENV=production` without an explicit override, which is the intended friction.

**No real lab protocol data in staging** unless the lab and Imperial data protection contacts have agreed to it.
