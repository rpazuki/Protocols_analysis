# Local email/password login without SSO

`AUTH_ADAPTER=local` supports real password authentication in development and
production. It does not relax the production prohibition on `mock` login.
There are no default accounts, passwords, email invitations or public signup.
Email is the login identifier. Password resets and account provisioning are
currently VM-operator commands, not an in-app user management screen.

## Production settings

Use a separate deployment environment file, such as `/etc/protocols-analysis/app.env`,
readable only by the operator. Example non-secret settings for the same VM as
BioPipeline2:

```dotenv
NODE_ENV=production
AUTH_ADAPTER=local
APP_URL=https://rlalab-assist.dept.ic.ac.uk:8444/protocols
APP_HOST_PORT=3200
ALLOWED_EMAIL_DOMAINS=ic.ac.uk,imperial.ac.uk
ADMIN_BOOTSTRAP_EMAILS=your-admin@imperial.ac.uk
```

Set a unique random `SESSION_SECRET` of at least 32 characters, and configure
`DATABASE_URL` for the **Protocols database**, not BioPipeline's database.
Do not copy BioPipeline's account/password database; these apps have separate
schemas and credentials. The existing production Compose file additionally
requires `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` for its separate
PostgreSQL container. `DATABASE_URL` in the app points to service hostname `db`
and normally uses the least-privilege role `protocols_app`; provision that role's
password out of band using the database owner, as described by migration 0002.
SSO client/proxy secrets are not needed in local mode.

The default image is built for `/protocols`. Keep that path in `APP_URL` and in
the reverse proxy. The host port can be changed with `APP_HOST_PORT` without
changing the container port. Check the port first:

```bash
sudo ss -lntp | grep -E ':(3200|8444)\b' || true
```

Keep BioPipeline's existing 8000/3100/8443 listeners and configuration intact.
For a separate nginx server block on 8444, preserve the application path:

```nginx
location /protocols/ {
    proxy_pass http://127.0.0.1:3200;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Configure `listen 8444 ssl`, `server_name` and the appropriate certificate/key
in that server block, allow 8444 in the firewall/SELinux policy as needed, and
run `nginx -t` before reloading. The existing certificate trust issue is
independent of the application port; changing ports will not fix it.

## Migration and first account

From the repository root, install dependencies (`npm ci`) for host-based
commands. Run `npm run db:migrate` using the Protocols **owner** database URL
before selecting local login. This applies migrations `0005_local_accounts.sql` and `0006_local_user_administration.sql`;
existing reports, roles and SSO configuration are preserved. Existing applied
migration files must not be edited.

For the Docker installation, use this function in Bash so every command selects
the right Compose file and environment file, regardless of the current directory:

```bash
protocols_compose() {
    docker compose -f infra/environments/production/docker-compose.yml \
        --env-file /etc/protocols-analysis/app.env "$@"
}
protocols_compose build app
protocols_compose up -d db
```

Run migration and provisioning with owner privileges in a subshell, leaving the
normal deployment's runtime credentials unchanged. Enter the owner URL with
hostname `db` inside the Compose network. Neither URL nor password is printed:

```bash
(
    set -e
    read -rsp 'Protocols owner database URL: ' DATABASE_URL
    printf '\n'
    export DATABASE_URL
    protocols_compose run --rm --entrypoint node app scripts/db/migrate.ts
    # Continue only if migration succeeds. Replace the email before running.
    protocols_compose run --rm --entrypoint node app \
        scripts/admin/local-users.ts create your-admin@imperial.ac.uk
)
protocols_compose up -d app
```

Stop on migration errors. Account commands prompt twice for a password without
echoing it; use an interactive terminal. `create` refuses an existing account,
rather than silently changing its password. Use an admin email listed in
`ADMIN_BOOTSTRAP_EMAILS` to obtain admin rights after login. Other accounts are
researchers; creating credentials alone does not grant administrator rights.
The runtime DB role cannot provision accounts or reset credentials.

Health check (no TLS required for this loopback-only diagnostic):

```bash
curl --noproxy '*' -fsS http://127.0.0.1:3200/protocols/api/health
protocols_compose logs --tail 60 app
```

Open `https://rlalab-assist.dept.ic.ac.uk:8444/protocols/auth/signin` and choose
email/password login. Verify login as both an admin and a researcher before
using the deployment. Identity is not verified through email delivery; the
operator must verify account ownership and communicate credentials securely.

## In-app account administration

When `AUTH_ADAPTER=local`, administrators have a **Users** page at
`/protocols/admin/users`. It lists and searches local email accounts, including
active/disabled status, role, last login, and required password changes.

- Create a researcher or administrator with a generated temporary password.
- Reset another user's password; copy the new temporary password from the result.
- Disable or reactivate accounts without changing report ownership or deleting reports.
- Promote/demote administrators. Configuration-backed admins and the last active
  local admin are protected. You cannot disable or reset your own account.

The app does not send email. Deliver temporary passwords securely to the intended
person. They are shown only in the operation result, never stored in plaintext,
placed in URLs or audit metadata, or redisplayed by a subsequent page load.
Every account/role change commits atomically with its audit event.

New and reset accounts must change their temporary password before viewing
reports, accepting the agreement or performing ordinary/admin actions. The new
password and confirmation have separate labelled rows. After changing it, the
user continues to the agreement if necessary. Signed-in local users can also use
**Change password** in the header; their current password is required. Password
changes revoke other sessions and refresh the current cookie.

Disabling and password resets immediately invalidate old cookies. Reactivation
also increments the credential version, so it cannot resurrect an old session.
Resetting a disabled account does not reactivate it. The Access page's denylist
remains independent; restore a block there before reactivating/promoting a user.
Account identities stay email-based and cannot be renamed through this page.

These pages and operations are unavailable under SSO. SSO role/access management
continues through Admins and Access; password management remains with the IdP.

## Account operations (owner CLI recovery)

Host installation, with `DATABASE_URL` set to the owner URL:

```bash
npm run local-users -- create person@imperial.ac.uk
npm run local-users -- reset person@imperial.ac.uk
npm run local-users -- disable person@imperial.ac.uk
npm run local-users -- reactivate person@imperial.ac.uk
```

For Docker, use the owner-URL subshell above and replace the create command with
`reset`, `disable` or `reactivate`. Do not put passwords on the command line. Resetting a
password increments its credential revision and invalidates old sessions;
disabling an account immediately rejects its login and existing sessions.
CLI creation/reset also requires a first-login password change. Reactivate restores
the account without resetting its password or lifting the separate denylist block.
Reset does not reactivate a disabled account. Admin role management and the
researcher denylist remain independent and continue to apply in local mode.

Passwords contain 12–1024 characters and are stored as salted scrypt hashes.
Ten failed attempts lock an existing account for 15 minutes. Failed attempts
commit their counters even though login is refused; account absence, a wrong
password, deactivation and lockout return the same generic login failure.
Backups contain credential hashes and must be protected accordingly.

## Switching to institutional SSO later

Change `AUTH_ADAPTER` to `entra-oidc` or `shibboleth-saml`, configure that
adapter's required settings, and recreate/restart the app. Existing local
sessions are rejected when local login is no longer selected. Reports and admin
roles remain associated with the normalized email, so the SSO provider must
release the same email for the same person. Local accounts are not automatically
removed; decide their retention and disable them if no longer needed.

Switching back to `local` rejects existing SSO/mock cookies and requires a local
password. Keep HTTPS, a strong application-specific session secret, and the
production mock-auth restrictions in every mode.

## Verification

Use a disposable PostgreSQL database for tests; they truncate application tables.
Set `TEST_DATABASE_URL` to that database and run:

```bash
npm run typecheck
npm run test:all
npm run test:local-production
```

The last command builds the app and tests a real production server: valid/invalid
passwords, rejection of foreign-origin submissions, Secure cookies, base-path
redirects, password-reset session invalidation, and blocked mock/SSO callbacks
when local login is selected. The privacy acknowledgement is versioned anew to
cover password-hash storage, so existing users will be prompted to acknowledge it.

## Upgrading an existing installation

Apply migration `0006_local_user_administration.sql` as the database owner **before**
starting the updated app. The local-mode health check returns 503 if the required schema is missing.
Existing accounts and reports are preserved; existing users
are not forced to change passwords merely by applying the migration. New/reset
accounts are forced to change them. No new environment variables are required.

The app must continue to use `protocols_app`, not the owner URL. Migration 0006
grants execution of two narrow SECURITY DEFINER functions with a fixed search path;
it does not grant INSERT or credential UPDATE on `local_accounts`. The functions
check the active actor/session version, serialize sensitive admin operations,
protect the last active local admin and append audit rows in the same transaction.
Raw account-table writes, schema changes, and editing audit history remain denied.
The original owner-only CLI remains the recovery path if no administrator can log in.

For the native Red Hat installation, follow the update procedure in
[the installation guide](../fresh_install_linux_redhat.md). Stop the app, use the
root-only owner environment for migrations, rebuild/copy standalone assets, then
restart and verify login. Keep owner credentials out of the app service environment.
