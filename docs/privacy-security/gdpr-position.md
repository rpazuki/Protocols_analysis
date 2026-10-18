# GDPR Position Notes

This is not legal advice. It is a planning note for review with the lab, Imperial ICT, and Imperial data protection contacts before collecting real lab data.

## Current Position

Imperial email addresses must be treated as personal data. ICO guidance says a corporate email address can directly identify an individual and reveal where they work. This means there are UK GDPR consequences even if the app stores only the user's email address and no other profile details.

That does not mean the app cannot store email addresses. It means the project needs the usual data protection controls:

- identify and document a lawful basis before production use;
- explain the processing in clear privacy information;
- collect only the fields needed for the stated lab protocol purpose;
- restrict access by role;
- protect the database, backups, exports, and admin tools;
- define retention and deletion rules;
- keep audit logs for sensitive operations;
- be ready to handle subject access or erasure questions through Imperial's normal process.

## Likely Data Categories

- Researcher email address: personal data.
- Protocol report text: may contain personal data if researchers type names, sample identifiers linked to people, patient information, collaborator names, or other identifiers.
- Outcome and hypothesis text: may contain personal data depending on what researchers type.
- Admin action logs: personal data where they identify the acting admin.
- Authentication tokens/session data: security-sensitive operational data.

An Imperial email address is not normally special category data by itself. However, free-text protocol fields could accidentally include special category data, especially health/genetic/patient-related details. The UI and policy should instruct users not to enter patient-identifiable or unnecessary personal data.

## Product Requirements From This

- Add visible but concise privacy/help text near long text fields: avoid patient-identifiable, participant-identifiable, or unrelated personal data.
- Require first-access acceptance of a privacy and use agreement before the user can create reports or use admin features.
- Treat the first-access agreement as an acknowledgement/privacy-and-use agreement unless Imperial reviewers explicitly decide UK GDPR consent is the correct lawful basis.
- Include admin export warnings because exports contain raw email addresses.
- Record export events in audit logs.
- Encrypt transport with HTTPS and keep database credentials out of source control.
- Keep production secrets in environment variables or VM-managed secret files.
- Apply least-privilege database access.
- Restrict PostgreSQL network access to the app host/admin routes required by the VM setup.
- Back up and restore the admin allowlist and database together.

## References Checked On 2026-08-30

- ICO: corporate email addresses can directly identify individuals and are personal data.
- ICO: UK GDPR principles include lawfulness, fairness, transparency, purpose limitation, data minimisation, storage limitation, security, and accountability.
- ICO: research-related processing still needs a lawful basis; for universities, public task may often be likely, depending on context.
- Imperial: University privacy notices and data protection guidance should be used for transparency and local governance.
- ICO: consent is not always the right lawful basis, particularly where there is a power imbalance such as public authority, employer, or university contexts.

## As Implemented

What the application does today against the controls listed above.

### Data minimisation

The only identity field stored anywhere is the normalized Imperial email address. The auth adapter boundary drops everything else the identity provider releases — no name, no employee id, no group membership. `AuthClaims` is the type that enforces this.

Audit metadata is sanitized before it is written: long strings are truncated, nested objects are dropped, and report free text is never copied into an audit event. The audit page is therefore not a second copy of the lab record.

Agreement acceptances record only the email address, the version, the timestamp, and an app/version string — no IP address, no user agent.

### Access control

- Access is open to everyone Imperial authenticates, minus a denylist admins manage. Sign-in is not by itself lab membership, so `ALLOWED_EMAIL_DOMAINS` should be set as a domain-level guard and offboarding should include blocking the account. A blocked account is refused on every route, including the agreement gate and exports, from its next request onward.
- Blocking withdraws access without deleting the person's reports: the lab record is evidence and outlives the author's access. An erasure request for report content goes through permanent delete, not through blocking.
- Researchers can reach only their own reports; the scope is applied in the database query.
- Admins can view, recycle, restore, and permanently delete any report, but **cannot edit another researcher's report content**, because that would break attribution.
- Admin status is re-read from the allowlist on every request.
- Exports are admin-only, checked server-side.

### Transparency

The first-access agreement is a gate: every authenticated page and action routes to it until the current version has been accepted. It is worded as an acknowledgement rather than as UK GDPR consent, per the note above. The text lives in `packages/domain/src/agreement.ts` behind `AGREEMENT_VERSION`; changing the wording and bumping the version re-prompts every user.

The report form carries inline guidance not to enter patient-identifiable, participant-identifiable, or unrelated personal data, next to both free-text fields, and the same warning appears in the page footer.

### Deletion

Deletion is two-stage. A recycled report keeps its content and can be restored. A permanent delete removes the `protocol_reports` row outright — the protocol free text genuinely leaves the database — and writes a `report_tombstones` row plus an audit event in the same transaction. The tombstone holds ids and timestamps only.

This gives a real answer to an erasure request for report content, while keeping enough to account for what happened.

### Security controls

- HTTPS is required in production: the app refuses to start unless `APP_URL` is `https://`, because session cookies are Secure-only.
- Sessions are signed JWTs in httpOnly, SameSite=Lax cookies; they carry identity but never a role.
- Mutations are Next.js server actions, which are same-origin checked.
- Security headers are set globally, including a CSP without `unsafe-eval` in production; report and admin routes are `no-store`.
- Every SQL value is a bound parameter; free text is stored verbatim and never interpreted, with tests to prove it.
- The app connects as `protocols_app`, which cannot alter the schema and holds only INSERT and SELECT on `audit_events` — audit history is append-only for the application, while a DBA can still perform agreed retention pruning or an erasure request.
- PostgreSQL publishes no ports in production; only the app container reaches it.
- No secrets in source control: `.env` is git-ignored, `.env.example` documents the variables, and production reads `/etc/protocols-analysis/app.env`.
- Exports carry an on-screen warning that they contain raw email addresses, and every export is audited.

### Audit coverage

`audit_events` records create, create-from-existing, update, recycle, restore, permanent delete, protocol-type changes, admin-list changes, access blocks and restores, agreement acceptance, exports, logins, and denied access attempts — the full list this document asked for.

Accountability-critical events **fail closed**: each commits in the same transaction as the change it records, so an admin grant, an access block, a deletion, or an export cannot succeed unaudited. Only logins and denied-access attempts are best-effort, where losing a row is better than failing the user's request.

### Still outstanding

These are decisions, not code, and none of them is silently pre-empted by the implementation:

1. **Lawful basis** documented and agreed.
2. **Retention periods** for active reports, recycle-bin reports, tombstones, audit events, backups, and exports. Nothing auto-deletes today, deliberately: applying an unagreed retention rule would be worse than keeping the data. When a period is agreed it belongs in a scheduled script that writes audit events.
3. **Privacy notice wording and sign-off** by the lab PI, department, ICT, and the Imperial data protection contact.
4. **Backup and restore procedure**, covering the database and the admin allowlist together.
5. **A decision on pseudonymisation** if exports are ever shared outside the lab or used for publication.

## Optional local authentication

When `AUTH_ADAPTER=local`, `local_accounts` additionally stores normalized email,
a salted scrypt password hash, credential revision, active status, failed-login
count, lockout time, and account/login timestamps. Plaintext passwords are not
stored or audited. Only VM operators with the owner database credential can
provision/reset accounts; the runtime database role can read hashes and update
login counters, but cannot replace passwords. Include this table in protected
database backups and privacy/retention review. SSO-only deployments need no
local accounts.
