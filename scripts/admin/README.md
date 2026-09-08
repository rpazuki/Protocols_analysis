# Admin Scripts

`admin-cli.ts` is the VM-level break-glass tool from [admin-management.md](../../docs/admin-ops/admin-management.md). It talks to the database directly and is the documented recovery path for when nobody can sign in as an admin.

```bash
node scripts/admin/admin-cli.ts check                       # connectivity, record counts, applied migrations
node scripts/admin/admin-cli.ts list [--all]                # the admin allowlist
node scripts/admin/admin-cli.ts add    name@ic.ac.uk        # break-glass grant
node scripts/admin/admin-cli.ts remove name@ic.ac.uk        # revoke
node scripts/admin/admin-cli.ts audit --action=export.run --limit=50

node scripts/admin/admin-cli.ts access list [--all]                    # the researcher denylist
node scripts/admin/admin-cli.ts access block name@ic.ac.uk --reason="Left the lab"
node scripts/admin/admin-cli.ts access unblock name@ic.ac.uk
```

In the production container:

```bash
docker compose run --rm --entrypoint node app scripts/admin/admin-cli.ts check
```

Notes:

- Every change is written to `audit_events` with the operating-system user and host recorded, so VM-level intervention is distinguishable from an in-app change.
- The change and its audit event commit in one transaction. If the audit write fails, the admin grant, revocation, or access block is rolled back — a break-glass change that nobody could account for afterwards would defeat the point of having a trail at all.
- The same guards as the UI apply: the last admin cannot be removed, a config-sourced admin must be changed in `ADMIN_BOOTSTRAP_EMAILS` rather than here, and an admin cannot be blocked without first losing admin rights.
- `access block` is the VM-level route for shutting someone out when no admin session is available. `ACCESS_DENYLIST_EMAILS` does the same from deployment config and is re-applied on every start.
- `check` exits non-zero when there are no active admins.
