# Database Package

PostgreSQL access shared by the web app, the mock API, and the operational scripts.

| Module | Contents |
| --- | --- |
| `client.ts` | connection pool, transaction helper, type parsers |
| `mappers.ts` | row shapes and row-to-domain mapping |
| `sql-builder.ts` | a minimal parameterized WHERE builder — every value is bound, nothing is interpolated |
| `migrate.ts` | forward-only migration runner with checksums |
| `repositories/` | reports, protocol types, admins, denylist, agreements, audit |

Notes:

- PostgreSQL `date` is parsed as a raw `YYYY-MM-DD` string. Letting it become a JS `Date` makes a report dated the 30th render as the 29th in a non-UTC process.
- `listReports(filter, ownerEmail)` applies the ownership scope on top of the caller's filter. Callers that must not see other researchers' reports pass it; admin views omit it. Keeping this in the repository means no page can widen its own scope.
- Exports stream through a server-side cursor, so a large export does not buffer the lab record in the app container's memory.
- `permanentlyDeleteReport()` deletes the row and writes the tombstone in one transaction.
- Mutating functions take an optional `client`, so a caller can commit the change and its audit event together. `addAdmin`/`removeAdmin` join a caller's transaction when given one and open their own when not.
- `streamReportsForExport()` rolls its cursor transaction back explicitly when the consumer stops early, which is what a cancelled download looks like from here.
