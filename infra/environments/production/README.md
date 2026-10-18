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
| the selected SSO adapter's secret is set (not needed for `local`) | `ENTRA_CLIENT_SECRET` or `SHIBBOLETH_PROXY_SECRET` |

For deployment without SSO, select `AUTH_ADAPTER=local` and follow
[Local password login](../../../docs/admin-ops/local-authentication.md). Mock
sign-in remains forbidden in production.

## Deploy

Secrets live in `/etc/protocols/app.env`, owned by root, mode 0600. Nothing secret belongs in the compose file or the image.

```bash
cd /srv/protocols/app
protocols_compose() {
    docker compose -f infra/environments/production/docker-compose.yml \
        --env-file /etc/protocols/app.env "$@"
}
protocols_compose build app
protocols_compose up -d db
```

Run migrations with the database owner, then start the app. The
[local authentication guide](../../../docs/admin-ops/local-authentication.md#migration-and-first-account)
includes the owner-URL subshell command; the same migration procedure applies
for SSO deployments. Do not run migrations as `protocols_app`.

```bash
# After migrations succeed:
protocols_compose up -d app
```

Migrations run explicitly, never automatically at boot. The runner refuses an
already-applied migration whose contents changed. Set the `protocols_app` role's
password out of band and use it in the app's runtime DATABASE_URL.

## Network shape

- PostgreSQL publishes no ports; only the app container reaches it over the compose network.
- The app binds to `127.0.0.1:${APP_HOST_PORT:-3200}` (container port 3000). TLS is terminated by the VM's reverse proxy.
- If Shibboleth is the approved route, that same proxy hosts the SP and must inject `SHIBBOLETH_PROXY_SECRET`. The app rejects any request without it, which is what stops a request that bypasses the proxy from forging an identity.

## Health and logs

`GET /protocols/api/health` is unauthenticated and returns no lab data — only whether the process can reach its database. The container healthcheck uses it. Container logs are capped at 5 × 10 MB.

## Recovery

```bash
protocols_compose run --rm --entrypoint node app scripts/admin/admin-cli.ts check
protocols_compose run --rm --entrypoint node app scripts/admin/admin-cli.ts list
protocols_compose run --rm --entrypoint node app scripts/admin/admin-cli.ts add name@ic.ac.uk
```

To restore admin access when the allowlist is broken, add the address to `ADMIN_BOOTSTRAP_EMAILS` and restart: config-sourced admins are reinstated on every start, and cannot be removed from the UI.

## Still to agree before real lab data

Backup and restore procedure (database and admin allowlist together), retention periods, log retention, OS patching, and sign-off on the privacy notice. See [gdpr-position.md](../../../docs/privacy-security/gdpr-position.md).
