# Seeds

Development seed data, applied by `scripts/db/seed.ts`.

```bash
npm run db:seed
```

**Development only.** The seed script refuses to run with `NODE_ENV=production`, because these files create mock users and a mock admin allowlist entry. Production bootstraps its admin from `ADMIN_BOOTSTRAP_EMAILS`.

| File | Contents |
| --- | --- |
| `0001_protocol_types.sql` | nine protocol types, one deliberately disabled so the disabled-type paths can be exercised |
| `0002_dev_admin.sql` | `mock.admin@ic.ac.uk` as a config-sourced admin |
| `0003_dev_reports.sql` | sample reports covering an active report, a second researcher, a recycled report, and two reports differing only by date |

`mock.colleague@ic.ac.uk` deliberately has no agreement acceptance, so the first-access gate can be tested.

All files are re-runnable.
