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

Secrets live in `/etc/protocols-analysis/app.env`, owned by root, mode 0600. Nothing secret belongs in the compose file or the image.

```bash
cd /srv/protocols/app
protocols_compose() {
    docker compose -f infra/environments/production/docker-compose.yml \
        --env-file /etc/protocols-analysis/app.env "$@"
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

## Updates

For an **existing production Compose installation**, take a protected database
backup, then run the updater as root from the checkout:

```bash
cd /srv/protocols/app
# First time only, fetch the script (reconcile any local edits first):
sudo -u protocols git status --short
sudo -u protocols git pull --ff-only
sudo bash scripts/deploy/update.sh --mode docker
```

On subsequent updates the last command alone pulls the current branch's
upstream. Use `--user` if the checkout belongs to a different Linux account,
`--app-env` for a different Compose environment file, or `--health-url` if
`APP_HOST_PORT` is not 3200.

Create `/etc/protocols-analysis/owner.env` as root, mode 0600, containing
`DATABASE_URL` for the **database owner**, using the Compose database hostname
`db`, and `DATABASE_SSL=false` for this internal non-TLS connection. The
runtime `app.env` must continue to use the restricted `protocols_app` role.
The updater loads the owner file through systemd and passes its database
variables to a one-off migration container without putting passwords in
command arguments. It needs Docker Compose v2, systemd, sudo, flock and curl.
Do not run it with `bash -x`.

Only `app` is built and recreated. The existing `db` container must already be
running. The updater never pulls/recreates PostgreSQL, changes its data volume,
or touches containers from the other projects. Compose image builds reuse
cached layers when possible. Migration checksums are validated every time;
only pending SQL files run. The old app stays up during the image build, then
stops for migrations. If migration fails it stays stopped for recovery. Once
started, the loopback health endpoint must pass before the command succeeds.
A failed health check leaves the app available for diagnosis using
`protocols_compose logs --tail=100 app`. After any failure, fix it and rerun;
there is no automatic database rollback. Backups and PostgreSQL version upgrades
remain separate operator tasks.

This is an alternative to the native systemd installation; do not use Docker
mode to update the native service described in the
[Red Hat guide](../../../docs/fresh_install_linux_redhat.md#updating-later).

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
