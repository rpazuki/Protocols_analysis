# Migrations

Forward-only SQL migrations, applied in filename order by `scripts/db/migrate.ts`.

```bash
npm run db:migrate
```

Rules:

- **The runner wraps each file in a transaction.** Do not put `BEGIN`/`COMMIT` in a migration.
- **Applied migrations are checksummed.** Editing one that has already run is a hard error, because on the production VM it means the schema is no longer defined by what is in the repository. Add a new migration instead.
- **Run as the database owner**, not as `protocols_app`, which deliberately cannot alter the schema.
- **Run explicitly on deploy**, never automatically at boot, so a rolling restart cannot silently change the schema.

| File | Contents |
| --- | --- |
| `0001_initial_schema.sql` | all tables, constraints, indexes, and the exact-duplicate unique index |
| `0002_app_role.sql` | the least-privilege `protocols_app` role and its grants |
| `0003_researcher_denylist.sql` | the researcher access denylist and its grant |
| `0004_denylist_from_config.sql` | explicit `from_config` marker, so a block dropped from config can be managed in the app |
| `0005_local_accounts.sql` | optional salted password accounts, lockout state and session credential revisions; owner-only provisioning |

| `0006_local_user_administration.sql` | first-login password changes and narrowly scoped, audited local account administration/password-change functions |
