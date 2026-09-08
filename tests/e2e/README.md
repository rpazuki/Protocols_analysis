# End-to-End Tests

Not implemented. The user journeys were verified manually in a browser during development (mock sign-in, the agreement gate, report creation, the duplicate block, create-from-previous, cross-researcher isolation, the admin-only redirect, CSV and JSONL export, the audit trail), and the same rules are covered by the integration and security suites at the repository layer.

If a browser suite is added later, Playwright against the mock auth adapter is the natural fit. The journeys worth automating first:

1. First access: sign in, be redirected to the agreement, accept, land on the report form.
2. Create a report, then be blocked submitting an exact duplicate, then succeed after changing the date.
3. Recycle a report, confirm it leaves the active list, restore it.
4. Permanent delete with the typed confirmation, and confirm the report is gone but the audit event remains.
5. As a researcher, open an admin URL and get the "lab admins only" page.
6. As an admin, run a CSV export and confirm the audit event.

CSRF behaviour is the other thing worth asserting in a real browser: a cross-origin POST to a server action should be refused.
