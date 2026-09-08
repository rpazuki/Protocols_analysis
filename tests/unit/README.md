# Unit Tests

```bash
npm test
```

Pure logic from `packages/domain`, no database required.

| File | Covers |
| --- | --- |
| `normalize.test.ts` | what the duplicate normalization must collapse, and what it must not |
| `duplicate-rule.test.ts` | the exact-duplicate key, including which fields are outside it |
| `dates.test.ts` | report dates as calendar dates, and "today" in the lab timezone |
| `authz.test.ts` | who may view, edit, recycle, restore, and permanently delete |
| `admin-allowlist.test.ts` | last-admin and config-admin removal guards |
| `export-schema.test.ts` | CSV and JSONL serialization, including spreadsheet formula injection |
| `validation.test.ts` | input schemas, blank filter-field parsing, denylist guards, and that a researcher email is never accepted from a form |
