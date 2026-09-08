# Production Environment

Imperial-hosted Red Hat Linux VM, Docker Server, PostgreSQL, one lab.

## Before first start

The app refuses to start unless all of these are true:

| Requirement | Why |
| --- | --- |
| `AUTH_ADAPTER` is not `mock` | mock auth lets anyone assert any identity |
| `SESSION_SECRET` is at least 32 characters | it signs the session cookie |
| `APP_URL` is `https://` | session cookies are Secure-only |
| `ADMIN_BOOTSTRAP_EMAILS` names at least one admin | otherwise nobody can administer the app |
| the selected adapter's secret is set | `ENTRA_CLIENT_SECRET` or `SHIBBOLETH_PROXY_SECRET` |

## Deploy

Secrets live in `/etc/protocols/app.env`, owned by root, mode 0600. Nothing secret belongs in the compose file or the image.

```bash
cd /srv/protocols/app
docker compose --env-file /etc/protocols/app.env build
docker compose --env-file /etc/protocols/app.env up -d
docker compose --env-file /etc/protocols/app.env run --rm --entrypoint node app scripts/db/migrate.ts
```

Migrations are run explicitly, never automatically at boot, so a restart cannot silently change the schema. The runner refuses to proceed if an already-applied migration's contents have changed.

## Network shape

- PostgreSQL publishes no ports; only the app container reaches it over the compose network.
- The app binds to `127.0.0.1:3000`. TLS is terminated by the VM's reverse proxy.
- If Shibboleth is the approved route, that same proxy hosts the SP and must inject `SHIBBOLETH_PROXY_SECRET`. The app rejects any request without it, which is what stops a request that bypasses the proxy from forging an identity.

## Health and logs

`GET /api/health` is unauthenticated and returns no lab data — only whether the process can reach its database. The container healthcheck uses it. Container logs are capped at 5 × 10 MB.

## Recovery

```bash
docker compose run --rm --entrypoint node app scripts/admin/admin-cli.ts check
docker compose run --rm --entrypoint node app scripts/admin/admin-cli.ts list
docker compose run --rm --entrypoint node app scripts/admin/admin-cli.ts add name@ic.ac.uk
```

To restore admin access when the allowlist is broken, add the address to `ADMIN_BOOTSTRAP_EMAILS` and restart: config-sourced admins are reinstated on every start, and cannot be removed from the UI.

## Still to agree before real lab data

Backup and restore procedure (database and admin allowlist together), retention periods, log retention, OS patching, and sign-off on the privacy notice. See [gdpr-position.md](../../../docs/privacy-security/gdpr-position.md).
