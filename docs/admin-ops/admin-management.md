# Admin Management Plan

Admin access starts from a configuration allowlist of Imperial email addresses.

## Requirements

- A bootstrap admin email must exist in deployment config before first production start.
- Admins can add or remove admin emails from an admin-only page.
- The current signed-in admin cannot accidentally remove the last admin without a guarded recovery path.
- All admin-list changes must be audited.
- Admin emails must be validated and normalized before save.
- The app should keep a previous version of the admin config so a lab admin can roll back a bad change on the VM.

## Storage Options

Preferred early implementation:

- bootstrap allowlist from environment/config file;
- runtime editable allowlist persisted in PostgreSQL or a mounted config file;
- audited changes in PostgreSQL.

PostgreSQL is operationally cleaner for audit history and concurrent updates. A mounted config file is simple for VM administration, but needs careful locking, backup, and rollback behaviour.

## Recovery

Document a VM-level recovery command before production:

- inspect current admin list;
- add a break-glass admin email;
- disable a compromised admin email;
- export audit events for investigation.


## Decision: PostgreSQL, Not A Mounted Config File

The earlier wording left open whether the runtime allowlist should be an app-managed store or a literal mounted config file that admins edit. **Resolved in favour of PostgreSQL.**

A mounted config file would need file locking, validation, atomic replace, backup, rollback, and a recovery story for a corrupted file — security-sensitive infrastructure work whose failure modes (a half-written file, two admins editing at once) are exactly the ones a database already solves. The requirements the file approach was meant to satisfy are met differently:

| Requirement | Met by |
| --- | --- |
| Audit history | `audit_events`, written in the same transaction as the change |
| Concurrent updates | A `FOR UPDATE`-locked read inside the transaction that applies the guards |
| Rollback of a bad change | Soft delete: removed entries keep `removed_at`/`removed_by`, and re-adding restores access |
| Recovery when the list is broken | `ADMIN_BOOTSTRAP_EMAILS`, re-applied on every start |
| VM-level operation | `scripts/admin/admin-cli.ts`, which writes the same audit events |

## As Implemented

The runtime-editable allowlist is stored in PostgreSQL (`admin_allowlist`).

- **Bootstrap.** `ADMIN_BOOTSTRAP_EMAILS` is reconciled into the table on the first authenticated request after a start. Those rows are marked `from_config`.
- **Rollback and recovery.** Config-sourced admins are reinstated on every start and cannot be removed through the UI, because deployment config would bring them back anyway. That is the break-glass path: edit `ADMIN_BOOTSTRAP_EMAILS` on the VM and restart. An admin dropped from config is *kept* as a normal admin rather than silently revoked, so tidying the config file cannot lock people out.
- **Last-admin guard.** Enforced inside a transaction that locks the active admin rows (`packages/db/src/repositories/admins.ts`), so two admins removing each other concurrently cannot both succeed.
- **Removal is soft.** `removed_at` and `removed_by` are recorded and the row is kept.
- **Validation.** Addresses are lowercased and validated, and checked against `ALLOWED_EMAIL_DOMAINS` when it is configured. A CHECK constraint enforces lowercase at the database level too.
- **Audit.** Every add and remove writes an `audit_events` row, from the UI and from the CLI. CLI changes record the operating-system user and host.
- **VM recovery commands** are implemented in [`scripts/admin/admin-cli.ts`](../../scripts/admin/README.md): `check`, `list`, `add`, `remove`, `audit`.

The one requirement met differently from the plan's wording: "keep a previous version of the admin config so a lab admin can roll back a bad change" is served by the soft-delete history plus the audit trail, rather than by versioned config files. `admin-cli.ts list --all` shows removed entries, and re-adding restores access.


## Researcher Access Denylist

Admin rights are one list; permission to use the app at all is another.

Imperial SSO authenticates the whole institution, which is broader than lab membership. Rather than a researcher allowlist — which would put an admin action in front of every new lab member's first protocol record — access is open to everyone the identity provider authenticates, and admins block named individuals from `/admin/access`.

- Stored in `researcher_denylist`: normalized email, optional reason, added/removed timestamps and actors.
- Checked in `getPrincipal()` on every request, so a block takes effect on the blocked user's next request.
- Refusal happens after authentication succeeds, and the person is told this app withdrew their access rather than that their login failed.
- The reason is shown to admins only. It is a note for whoever reviews the decision later, not a message the app delivers.
- Blocking does not delete reports, and does not remove admin rights. An admin must be removed as an admin before they can be blocked, so the two lists cannot disagree about who has access.
- Blocks and restores are audited, and commit with their audit event.
- `ACCESS_DENYLIST_EMAILS` applies a block from deployment config when no admin session is available. While an address is listed there the entry is pinned (`from_config = true`): re-asserted on every start, and not liftable from the admin page, because config would reinstate it anyway.
- Removing an address from that variable **unpins the entry but does not restore access**. The block stays in force and becomes an ordinary in-app entry the admin page can lift. Tidying a config file should never silently give someone their access back, and this is the same rule the admin allowlist follows in the other direction: a config edit never quietly changes who has access.

This is not a substitute for offboarding: until someone is blocked, anyone Imperial authenticates can create reports. Set `ALLOWED_EMAIL_DOMAINS` as a domain-level guard alongside it.

### Recovery Commands

```bash
node scripts/admin/admin-cli.ts access list
node scripts/admin/admin-cli.ts access block name@ic.ac.uk --reason="Left the lab"
node scripts/admin/admin-cli.ts access unblock name@ic.ac.uk
```

## Local login mode

With `AUTH_ADAPTER=local`, use **Users** for account creation and password resets.
Adding an admin requires an active local account; the last active local admin is
protected even if disabled or SSO-only addresses remain in the allowlist.
[Local account administration](local-authentication.md) describes temporary
passwords, first-login changes, deactivation and recovery.
