# Integration Tests

```bash
TEST_DATABASE_URL=postgres://localhost/protocols_test npm run test:integration
```

Skips itself when `TEST_DATABASE_URL` is unset. Point it at a throwaway database — every table is truncated between tests.

These run against a real PostgreSQL because the rules they check live in the database: the exact-duplicate unique index, the CHECK constraints, and the generated normalization column.

| File | Covers |
| --- | --- |
| `reports.test.ts` | create, update, the full duplicate rule, the recycle-bin lifecycle, tombstones, filtering, pagination, export streaming |
| `admins-and-agreement.test.ts` | config bootstrap and its break-glass behaviour, allowlist guards, agreement acceptance, audit writing |
| `audit-fail-closed.test.ts` | forces the audit INSERT to fail inside each transaction and asserts the mutation rolls back with it |
| `export-streaming.test.ts` | cursor cleanup when a download is cancelled, checked against `pg_stat_activity` |
| `cli-audit.test.ts` | runs the real `admin-cli.ts` against a database that rejects audit inserts, asserting the CLI's admin and access changes roll back |

Test files run with `--test-concurrency=1` because they share one database.

In CI, run `npm run test:integration:required`, which fails rather than skips when `TEST_DATABASE_URL` is missing.
