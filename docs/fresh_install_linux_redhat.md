# Fresh Protocols installation on an existing Red Hat server

This procedure reuses the machine's installed PostgreSQL, nginx, Git and Node.js.
It uses a native systemd service, so no second PostgreSQL container or Docker
installation is needed. BioPipeline2 keeps its existing ports, database, service
account, nginx site and TLS configuration.

The examples use:

| Item | Protocols setting |
| --- | --- |
| Checkout | `/opt/protocols-analysis` |
| Linux account / service | `protocols` / `protocols-analysis.service` |
| PostgreSQL database | `protocols_analysis` |
| Database owner / runtime role | `protocols_owner` / `protocols_app` |
| Internal listener | `127.0.0.1:3200` |
| Public URL | `https://rlalab-assist.dept.ic.ac.uk:8444/protocols` |
| Login method | Local email and password, `AUTH_ADAPTER=local` |

Run blocks in order in Bash. Stop on errors. Replace the email, passwords and
certificate/key paths before using the examples. The local-login changes must
be committed and pushed to GitHub before installing from another machine.
These commands have not been executed on your Red Hat host.

## 1. Check installed prerequisites and free ports

```bash
cat /etc/redhat-release
command -v git node npm psql nginx openssl systemd-run
node --version
npm --version
node --experimental-strip-types -e 'console.log("TypeScript operational scripts supported")'
sudo systemctl --no-pager status postgresql nginx
sudo -u postgres psql -X -c 'SELECT version();'
sudo ss -lntp | grep -E ':(3200|8444)\b' || true
sudo nginx -t
getenforce
```

Use Node 24 (tested in the production image), or a current Node 22 release with
built-in TypeScript stripping (22.18+). The service below uses `/usr/bin/node`;
if Node is installed elsewhere, substitute its absolute path. Ensure `npm` uses
the same Node installation. Do not replace another application's Node runtime
without checking its requirements.

If 3200 or 8444 is occupied, choose another free port and change **all matching
values in this guide**. For PostgreSQL installed from PGDG, adjust the service
name and administrator commands to that installation. Do not initialize or
replace the existing PostgreSQL cluster.

## 2. Create a separate Linux account and clone Git

```bash
getent passwd protocols >/dev/null || sudo useradd --system \
    --home-dir /opt/protocols-analysis --shell /sbin/nologin protocols
sudo install -d -o protocols -g protocols /opt/protocols-analysis
sudo install -d -o root -g root -m 0700 /etc/protocols-analysis

if ! sudo test -d /opt/protocols-analysis/.git; then
    sudo -u protocols git clone https://github.com/rpazuki/Protocols_analysis.git \
        /opt/protocols-analysis
fi
cd /opt/protocols-analysis
sudo -u protocols git log -1 --oneline
sudo -u protocols git status --short
```

The HTTPS clone needs repository access if the repository is private. Use an
approved Git credential method; do not put a token in the URL or copy your
personal SSH private key into the service account. An already-existing checkout
is not automatically updated by the conditional clone. Select the intended
release and reconcile local edits before continuing.

Confirm this revision contains local login, then install dependencies:

```bash
cd /opt/protocols-analysis
test -f db/migrations/0006_local_user_administration.sql
test -f scripts/admin/local-users.ts
sudo -u protocols npm ci
```

## 3. Create a separate database and roles

Inspect first. If any of these names already exist, stop and establish who owns
and uses them before creating/resetting anything:

```bash
sudo -u postgres psql -X -c \
    "SELECT rolname FROM pg_roles WHERE rolname IN ('protocols_owner','protocols_app');"
sudo -u postgres psql -X -c \
    "SELECT datname FROM pg_database WHERE datname='protocols_analysis';"
```

For a fresh installation where those names are unused:

```bash
sudo -u postgres createuser --no-superuser --no-createdb --no-createrole \
    --pwprompt protocols_owner
sudo -u postgres createuser --no-superuser --no-createdb --no-createrole \
    --pwprompt protocols_app
sudo -u postgres createdb --owner=protocols_owner protocols_analysis
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d protocols_analysis \
    -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'
```

Choose different owner/runtime passwords and retain them securely. Creating the
runtime role first avoids requiring `CREATEROLE` during migration 0002. The app
never needs PostgreSQL superuser or schema-owner privileges.

Add authentication rules scoped only to the new database/roles:

```bash
PG_HBA=$(sudo -u postgres psql -X -tAc 'SHOW hba_file')
sudo cp -a "$PG_HBA" "${PG_HBA}.before-protocols"
for PG_ROLE in protocols_owner protocols_app; do
    PG_RULE="host protocols_analysis ${PG_ROLE} 127.0.0.1/32 scram-sha-256"
    if ! sudo grep -Fxq "$PG_RULE" "$PG_HBA"; then
        sudo sed -i "1i $PG_RULE" "$PG_HBA"
    fi
done
sudo -u postgres psql -X -c 'SELECT pg_reload_conf();'

psql -h 127.0.0.1 -U protocols_owner -d protocols_analysis -W -c 'SELECT 1;'
psql -h 127.0.0.1 -U protocols_app -d protocols_analysis -W -c 'SELECT 1;'
```

Stop if either connection fails. No PostgreSQL restart or network exposure is
needed for these scoped authentication rules.

`/etc/protocols` is the operating system's IP protocol-name file, not an
application configuration directory. Leave it untouched. This guide uses
`/etc/protocols-analysis/` instead.

## 4. Create runtime and owner environment files

Generate a new application-specific session secret:

```bash
openssl rand -hex 48
sudoedit /etc/protocols-analysis/app.env
```

Paste this into **the file**, replacing the placeholders:

```dotenv
NODE_ENV=production
AUTH_ADAPTER=local
APP_NAME="Lab Protocols Analysis"
APP_URL=https://rlalab-assist.dept.ic.ac.uk:8444/protocols
APP_BASE_PATH=/protocols
NEXT_PUBLIC_BASE_PATH=/protocols
APP_TIMEZONE=Europe/London
ENVIRONMENT_LABEL=EXPERIMENTAL
SESSION_SECRET=REPLACE_WITH_GENERATED_SECRET
SESSION_TTL_HOURS=12
DATABASE_URL=postgres://protocols_app:RUNTIME_PASSWORD@127.0.0.1:5432/protocols_analysis
DATABASE_SSL=false
ADMIN_BOOTSTRAP_EMAILS=YOUR_ADMIN_EMAIL@imperial.ac.uk
ALLOWED_EMAIL_DOMAINS=ic.ac.uk,imperial.ac.uk
NEXT_TELEMETRY_DISABLED=1
PORT=3200
HOSTNAME=127.0.0.1
```

For this same-host database, PostgreSQL TLS is disabled on the loopback
connection; public application access still uses HTTPS. If your institution
requires database TLS, configure its trusted CA instead.

Now create **a different file** for operator-only database commands:

```bash
sudoedit /etc/protocols-analysis/owner.env
```

File contents:

```dotenv
DATABASE_URL=postgres://protocols_owner:OWNER_PASSWORD@127.0.0.1:5432/protocols_analysis
DATABASE_SSL=false
```

URL-encode special characters in both passwords (`%40` for `@`, `%25` for `%`).
Do not paste a password containing literal URL separators into these URLs.
Do not reuse BioPipeline's session secret or database credentials.

```bash
sudo chown root:root /etc/protocols-analysis/app.env /etc/protocols-analysis/owner.env
sudo chmod 600 /etc/protocols-analysis/app.env /etc/protocols-analysis/owner.env
```

systemd reads these files as root and passes their values to the selected
process. The normal web service receives only `app.env`; it cannot read or use
the owner file. No SSO secrets are required in local mode.

## 5. Migrate, then create the first local administrator

Use the owner file for schema changes and local-account provisioning:

```bash
sudo systemd-run --wait --pipe --collect --uid=protocols \
    --property=EnvironmentFile=/etc/protocols-analysis/owner.env \
    --working-directory=/opt/protocols-analysis \
    /usr/bin/node --experimental-strip-types scripts/db/migrate.ts
```

Continue only after migration succeeds. It must include
`0005_local_accounts.sql` and `0006_local_user_administration.sql`. Verify the table through the owner connection if needed:

```bash
psql -h 127.0.0.1 -U protocols_owner -d protocols_analysis -W \
    -c 'SELECT filename FROM schema_migrations ORDER BY filename;'
```

Replace the email below with the **same address** configured in
`ADMIN_BOOTSTRAP_EMAILS`:

```bash
sudo systemd-run --wait --pty --collect --uid=protocols \
    --property=EnvironmentFile=/etc/protocols-analysis/owner.env \
    --working-directory=/opt/protocols-analysis \
    /usr/bin/node --experimental-strip-types scripts/admin/local-users.ts \
    create YOUR_ADMIN_EMAIL@imperial.ac.uk
```

Enter and confirm a password of 12–1024 characters. There are no default login
credentials and no email is sent. This initial password must be changed at first login.
Administrator status comes from the configured
admin list; creating a local account by itself does not grant admin rights.

## 6. Build the production frontend

The checked-in `apps/web/next.config.ts` explicitly sets both `turbopack.root`
and `outputFileTracingRoot` to the repository root (two directories above the
config). This lets Next find dependencies hoisted into the root `node_modules`.
Use the corrected Git revision; do not install Next globally to work around a
workspace-root error.

```bash
cd /opt/protocols-analysis
sudo -u protocols npm ci
sudo -u protocols node -p "require.resolve('next/package.json', { paths: [process.cwd() + '/apps/web'] })"
sudo -u protocols env NODE_ENV=production NEXT_PHASE=phase-production-build \
    NEXT_TELEMETRY_DISABLED=1 APP_BASE_PATH=/protocols NEXT_PUBLIC_BASE_PATH=/protocols \
    npm run build --workspace apps/web

sudo -u protocols mkdir -p apps/web/.next/standalone/apps/web/.next
sudo -u protocols mkdir -p apps/web/.next/standalone/apps/web/.next/static
sudo -u protocols cp -a apps/web/.next/static/. apps/web/.next/standalone/apps/web/.next/static/
if [ -d apps/web/public ]; then
    sudo -u protocols cp -a apps/web/public apps/web/.next/standalone/apps/web/
fi
test -f apps/web/.next/standalone/apps/web/server.js
```

This is a monorepo: use the `apps/web/server.js` path inside the standalone
bundle, not BioPipeline's frontend path. `public` is optional; `.next/static`
must be copied. Runtime auth checks are deferred only during the build; do not
set `NEXT_PHASE` in the permanent service environment.

### If Turbopack cannot find `next/package.json`

If the error says the filesystem root is `/opt/protocols-analysis/apps/web`,
check the configuration contains these entries inside `const config: NextConfig`:

```typescript
turbopack: { root: path.resolve(__dirname, '../..') },
outputFileTracingRoot: path.resolve(__dirname, '../..'),
```

`path` is already imported by the file. The checked-in version uses an equivalent
`workspaceRoot` constant. Do not duplicate the entries. Then rerun section 6,
starting with `npm ci` from `/opt/protocols-analysis`, not `apps/web`. If the
`require.resolve` command fails, dependency installation is incomplete; resolve
that failure before building. Avoid simultaneous installs/builds in one checkout.
If updating a running service, stop it before rebuilding its standalone output.

## 7. Install and start the service

Create a new unit without editing any BioPipeline unit:

```bash
sudo tee /etc/systemd/system/protocols-analysis.service >/dev/null <<'UNIT'
[Unit]
Description=Protocols Analysis web application
After=network-online.target
Wants=network-online.target

[Service]
Type=exec
User=protocols
Group=protocols
WorkingDirectory=/opt/protocols-analysis/apps/web/.next/standalone
EnvironmentFile=/etc/protocols-analysis/app.env
ExecStart=/usr/bin/node apps/web/server.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now protocols-analysis
curl --noproxy '*' --fail --silent --show-error --retry 30 --retry-delay 2 \
    --retry-connrefused --retry-max-time 60 \
    http://127.0.0.1:3200/protocols/api/health
```

Expected: `status: ok` and `authAdapter: local`. If it fails:

```bash
sudo systemctl --no-pager --full status protocols-analysis
sudo journalctl -u protocols-analysis -b -n 80 --no-pager
sudo ss -lntp | grep ':3200' || true
```

Do not proceed to nginx until the local health check passes. If you edited the
environment file after starting the service, restart the service to reload it.

## 8. Add a separate nginx site on HTTPS 8444

Find the certificate and private-key paths in your existing working site:

```bash
sudo nginx -T 2>&1 | grep -E 'ssl_certificate(_key)? '
```

A certificate for `rlalab-assist.dept.ic.ac.uk` can also serve that hostname on
8444; certificates are not tied to port numbers. Reuse the matching certificate
chain and key paths from the existing site, without overwriting them. The
Imperial private-CA trust question remains independent of this installation.

```bash
sudoedit /etc/nginx/conf.d/protocols-analysis.conf
```

Paste this into **that configuration file**, substituting the actual
certificate and matching key paths:

```nginx
server {
    listen 8444 ssl;
    server_name rlalab-assist.dept.ic.ac.uk;

    ssl_certificate /ACTUAL/PATH/TO/FULLCHAIN.pem;
    ssl_certificate_key /ACTUAL/PATH/TO/MATCHING.key;

    location = / {
        return 302 /protocols/auth/signin;
    }
    location = /protocols {
        return 302 /protocols/auth/signin;
    }
    location /protocols/ {
        proxy_pass http://127.0.0.1:3200;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Host $http_host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }
}
```

Do not strip `/protocols` when proxying: Next.js was built for that base path.
Do not add this server block to BioPipeline's existing 8443 block or change
its proxy ports. Preserving the public host **including the port** allows
Next.js to validate same-origin form submissions correctly.

Check SELinux policy before changing it:

```bash
if [ "$(getenforce)" != "Disabled" ]; then
    sudo getsebool httpd_can_network_connect
    sudo semanage port -l | grep '^http_port_t'
fi
```

If the boolean is off, set `sudo setsebool -P httpd_can_network_connect 1`.
If 8444 is not already allowed for HTTP servers and is not assigned to another
service type, add it:

```bash
sudo semanage port -a -t http_port_t -p tcp 8444
```

Skip that command if already allowed. Do not reassign a port belonging to
another SELinux type without reviewing that service. Keep SELinux enabled.
If `semanage` is missing, install `policycoreutils-python-utils` through the
server's approved package-management procedure.

```bash
sudo nginx -t && sudo systemctl reload nginx
if sudo systemctl is-active --quiet firewalld; then
    sudo firewall-cmd --get-active-zones
    sudo firewall-cmd --permanent --add-port=8444/tcp
    sudo firewall-cmd --reload
fi
```

These firewall commands use the default zone; specify the appropriate active
zone if this server's interface uses another one. Institutional/Zscaler access
rules may also need to permit 8444. Keep 3200 and PostgreSQL private.

## 9. Verify locally and from your computer

On the server, verify nginx's selected virtual host without depending on DNS:

```bash
curl --noproxy '*' --resolve rlalab-assist.dept.ic.ac.uk:8444:127.0.0.1 \
    https://rlalab-assist.dept.ic.ac.uk:8444/protocols/api/health
```

From your computer, open:

```text
https://rlalab-assist.dept.ic.ac.uk:8444/protocols/auth/signin
```

Choose local email/password login, use the account created in section 5, change
the initial password, then accept the privacy acknowledgement, and verify report creation. Test a second local
account as a researcher. TLS trust failures require a trusted certificate or the
agreed ICT access/trust configuration; a successful `curl -k` test alone does
not establish browser trust.

If another app appears, check `sudo ss -lntp`, the service's working directory
and `sudo nginx -T` before rebuilding: a healthy HTTP response can come from
the wrong application.

## 10. More accounts and password resets

Use **Users** in the app for normal account administration. For owner-only recovery,
use the owner environment and an interactive terminal. Change the operation to
`create`, `reset`, `disable` or `reactivate` as required:

```bash
sudo systemd-run --wait --pty --collect --uid=protocols \
    --property=EnvironmentFile=/etc/protocols-analysis/owner.env \
    --working-directory=/opt/protocols-analysis \
    /usr/bin/node --experimental-strip-types scripts/admin/local-users.ts \
    create person@imperial.ac.uk
```

Reset invalidates old sessions; disable rejects login and existing sessions.
The Users page generates temporary passwords and the Change password page lets
users replace them. There is no self-service signup or invitation/reset email.
The owner CLI remains available if normal administrator access is lost.

## Updating later

Use the updater after the initial installation. Take a protected database
backup first using your normal backup procedure. The script does not create
backups or downgrade database migrations.

For the **first update that introduces the script**:

```bash
cd /opt/protocols-analysis
sudo -u protocols git status --short
# If any changes are listed, reconcile them before continuing.
sudo -u protocols git pull --ff-only
sudo bash scripts/deploy/update.sh
```

For subsequent updates, just run:

```bash
sudo bash /opt/protocols-analysis/scripts/deploy/update.sh
```

The script pulls the current branch's configured Git upstream using
`--ff-only`, runs `npm ci --include=dev`, checks migration checksums and applies
only pending migrations using `owner.env`, builds the standalone app, copies
CSS/static assets and optional `public`, starts `protocols-analysis`, and polls
its loopback health endpoint. It never sources environment files as shell code
or passes database passwords in command arguments. No `rg` installation is
needed. Git and npm run as `protocols`; run the updater itself as root.

There is downtime while the native app is rebuilt. Even if Git is already
up to date, the updater rebuilds and rechecks migrations: this lets you retry
an interrupted deployment or apply environment changes. Existing migration
files must never be edited; add new numbered SQL files instead. The script
uses the existing migration runner; already-applied migrations are skipped.

It refuses dirty/untracked checkout files and concurrent updater runs. Avoid
manual installs/builds while it is running. If dependencies, migrations or the
build fail after the app stops, it remains stopped; correct the reported error
and rerun the same command. If health fails after startup, inspect
`sudo journalctl -u protocols-analysis -n 100 --no-pager`; the script exits
unsuccessfully and leaves the process available for diagnosis. It does not
reset Git, automatically roll back schema changes, overwrite environment
files, restart nginx, or change BioPipeline/Lab AI Assistant.

For a different native service/user/port, use explicit options, for example:

```bash
sudo bash scripts/deploy/update.sh --user protocols --service protocols-analysis \
    --health-url http://127.0.0.1:3200/protocols/api/health
sudo bash scripts/deploy/update.sh --help
```

Keep `--base-path` (default `/protocols`) aligned with your runtime environment
and nginx route. The Docker image uses the repository's default `/protocols`
build prefix. See [Docker updates](../infra/environments/production/README.md#updates)
only if you installed the production Compose stack instead of this native service.

For details of local authentication, session invalidation and switching back to
SSO later, see [local-authentication.md](admin-ops/local-authentication.md).

## Fixing repeated “Not found” pages under /protocols

An older revision passed already-prefixed relative paths to Next.js redirects.
Next added its configured base path again, producing `/protocols/protocols/...`
and a 404. The corrected revision uses same-origin absolute redirect URLs and
adds the base path exactly once, including after login, agreement acceptance,
report creation/editing and admin redirects.

After the correction is committed and pushed, deploy it from the repository:

```bash
cd /opt/protocols-analysis
sudo -u protocols git status --short
# Stop here and reconcile local edits before pulling if any are listed.
sudo -u protocols git pull --ff-only
sudo systemctl stop protocols-analysis
sudo -u protocols npm ci
sudo systemd-run --wait --pipe --collect --uid=protocols \
    --property=EnvironmentFile=/etc/protocols-analysis/owner.env \
    --working-directory=/opt/protocols-analysis \
    /usr/bin/node --experimental-strip-types scripts/db/migrate.ts
sudo -u protocols env NODE_ENV=production NEXT_PHASE=phase-production-build \
    NEXT_TELEMETRY_DISABLED=1 APP_BASE_PATH=/protocols NEXT_PUBLIC_BASE_PATH=/protocols \
    npm run build --workspace apps/web
sudo -u protocols mkdir -p apps/web/.next/standalone/apps/web/.next/static
sudo -u protocols cp -a apps/web/.next/static/. apps/web/.next/standalone/apps/web/.next/static/
if [ -d apps/web/public ]; then
    sudo -u protocols cp -a apps/web/public apps/web/.next/standalone/apps/web/
fi
sudo systemctl start protocols-analysis
```

Stop on any build/copy failure rather than restarting an incomplete build. This
routing change itself needs no nginx change. Current versions also include local
account administration: apply pending database migrations as shown above. The privacy acknowledgement
version changes to reflect the synthetic biology wording, so users acknowledge
the updated text at next access. Open the clean URL
`https://rlalab-assist.dept.ic.ac.uk:8444/protocols/auth/signin`, rather than an
old bookmarked URL containing `/protocols/protocols/`.

## Local user administration

After the first administrator signs in, use **Users** to create accounts, reset
passwords, disable/reactivate users and manage roles. Deliver each generated temporary
password securely; the user must change it on first login before accessing reports.
Use **Change password** for your own password. No email service is required.

When updating from a version before this feature, apply migration
`0006_local_user_administration.sql` using the owner environment before restarting
the new build. Existing accounts/reports are retained and no new environment settings
are needed. Keep `DATABASE_URL` in the running service set to the app-role URL.
See [local authentication](admin-ops/local-authentication.md) for safeguards and recovery.
