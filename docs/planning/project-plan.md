# Protocols Analysis Project Plan

This project is an internal lab web app for researchers to record daily protocol variations and outcomes, then export structured records for later LLM analysis.

This document is the architecture plan. The plan has since been implemented; see the [repository README](../../README.md) for how to run, test, and deploy the result, and [implementation-notes.md](implementation-notes.md) for the decisions taken while building it.

Canonical product brief: [product-overview.md](product-overview.md).

## Product Goals

- Give each researcher a fast daily form for recording a protocol variation.
- Capture the minimum structured metadata needed for later comparison: date, researcher email/username, protocol type, protocol name, free text description, outcome, and optional outcome hypothesis.
- Default the date to today while allowing the researcher to change it.
- Keep researcher identity non-editable and derived from the authenticated session.
- Allow researchers to view, edit, copy into a new report, move to recycle bin, restore, and permanently delete their own submissions according to the recycle-bin workflow.
- Allow admins to manage protocol types, view all submissions, and export data.
- Prevent exact duplicate submissions with the same researcher, same report date, and same normalized main protocol description text.
- Require first-access acceptance of a privacy and use agreement explaining email-address use.
- Keep the development login mockable, but isolate the mock path from the production SSO integration.

## Roles

- Researcher: creates, views, edits, copies, recycles, restores, and permanently deletes only their own protocol reports, subject to final restore/delete policy.
- Admin: manages protocol types, views all protocol reports, manages recycled reports, manages admin allowlist, and exports reports.
- System: derives the email/username from authentication claims and enforces authorization server-side.

Current scope: one lab only.

## MVP Data Model

### protocol_reports

- id
- report_date
- researcher_email: the app username, derived from authentication
- protocol_type_id
- protocol_type_label_snapshot
- protocol_name
- description_text
- outcome: success or failure
- outcome_hypothesis: nullable long text
- created_at
- updated_at
- deleted_at: nullable; set when moved to recycle bin
- deleted_by: nullable admin or owner username/email
- restored_at: nullable
- restored_by: nullable admin username/email
- permanently_deleted_at: nullable if tombstones are retained

Reports move to a recycle bin first. From the recycle bin, an authorized user can restore the report or permanently delete it. Permanent deletion should remove report content from normal application storage, while a minimal audit/tombstone event may remain if required for accountability.

Protocol type labels must be preserved on each report so historical user submissions keep the exact type label that was active when the report was saved.

Duplicate prevention should block only exact duplicates for the same researcher, same report date, and same normalized main protocol description text. It does not compare protocol name, protocol type, outcome, or outcome hypothesis. If date or main protocol wording differs, the repeated protocol is allowed.

### protocol_types

- id
- label
- description: optional
- active
- sort_order
- created_at
- updated_at

### researcher_denylist

Imperial SSO authenticates the whole institution, which is broader than lab membership. Rather than a researcher allowlist, which would gate every new lab member on an admin action, access is open to everyone the identity provider authenticates and admins block named individuals.

- email (normalized), reason, added_at, added_by, removed_at, removed_by.
- Checked on every authenticated request, so a block takes effect on the user's next request.
- A denied user is refused *after* authentication succeeds, and told the app withdrew their access, so nobody concludes their Imperial login is broken.
- Blocking does not delete reports and does not remove admin rights; an admin must be removed as an admin first.
- Managed from an admin-only page, and audited. `ACCESS_DENYLIST_EMAILS` allows an urgent block from deployment config without a working admin session.

### admin_access

Admin access starts from a config allowlist. The running app includes an admin-only page to edit that allowlist by adding or removing admin email addresses.

**Resolved:** the runtime allowlist is an app-managed store in PostgreSQL (`admin_allowlist`), not a mounted config file. PostgreSQL gives audit history and safe concurrent updates for free, which a mounted file would need file locking, backup, and rollback machinery to match; the bootstrap config list plus soft-delete history covers the rollback requirement. Changes are validated, audited, and guarded so the last admin cannot be removed.

### audit_events

Recommended for accountability, especially because researchers can edit and delete records. Keep this minimal: actor email, action, record id, timestamp, and small metadata. No extra user profile data.

### user_agreement_acceptances

- researcher_email
- agreement_version
- accepted_at
- accepted_from: optional security/app metadata

## Authentication Plan

The auth boundary should be provider-adapter based:

- Development: mock auth adapter injects a test username and role for local development.
- Production preferred path: Microsoft Entra ID using OIDC, if Imperial ICT approves the application registration and claims.
- Production alternative path: Shibboleth/SAML, using Imperial's institutional IdP/federation metadata if ICT prefers that route.

The application should never store passwords. The stored user identifier should be the authenticated Imperial email address derived from trusted auth claims, not a form field. All write, edit, copy, recycle-bin, permanent-delete, admin, restore, and export permissions must be checked server-side.

External references checked on 2026-08-30:

- Imperial public ICT pages describe Microsoft 365 access using an Imperial username in the `username@ic.ac.uk` form with MFA.
- The UK federation IdP list includes Imperial College London with entityID `https://shibboleth.imperial.ac.uk/shibboleth`.
- Microsoft Entra ID supports federation-based SSO through SAML 2.0 and OpenID Connect.
- ICO guidance treats a corporate email address that directly identifies a person as personal data. Therefore this project must handle Imperial email addresses as UK GDPR personal data even if no other user profile fields are stored.

## Main User Flows

### Researcher

1. User signs in through mock auth in development or Imperial SSO in production.
2. New protocol form opens with today's date and the email/username already filled from the session.
3. User chooses protocol type from an admin-managed dropdown.
4. User enters protocol name, description, success/failure outcome, and optional hypothesis.
5. User saves the report.
6. User can review, edit, or delete previous own reports.
7. User can create a new draft from an own previous report.
8. User can access a recycle bin for own deleted reports and either restore or permanently delete them.

### Admin

1. Admin signs in through the same auth path.
2. Admin views all reports with filters for date range, protocol type, researcher email, outcome, and text search.
3. Admin creates, renames, disables, and reorders protocol types.
4. Admin manages the admin allowlist.
5. Admin accesses the recycle bin for all reports.
6. Admin exports data for analysis.

## Export Plan

Initial export formats:

- CSV for spreadsheet review.
- JSONL for LLM analysis pipelines.

Export records should include a schema version and clear field names. The export should support date range, protocol type, researcher email, and outcome filters. The current requirement is to export raw usernames/email addresses. If exports are later shared outside the lab or reused for publication, revisit pseudonymisation/anonymisation with the lab, ICT, and data protection contacts.

## Privacy And Security Principles

- SSO accounts store no local passwords. The optional local-login mode stores salted password hashes and minimal login-security state, alongside the normalized email used for attribution and access control; see [local authentication](../admin-ops/local-authentication.md).
- Treat the stored Imperial email address as personal data.
- Keep auth claims processing in one server-side module.
- Make the email/username visible but non-editable in the UI.
- Require CSRF protection or same-site server actions for mutations.
- Use server-side authorization for every record access.
- Add audit logging before production for create, edit, copy-from-existing, recycle-bin move, restore, permanent delete, admin-list changes, protocol-type changes, agreement acceptance, and export events.
- Confirm retention, backup, and delete policy before real lab data is collected.

## Deployment Assumptions

- Hosting target: Imperial-hosted Red Hat Linux VM controlled by the lab admin.
- Runtime platform: Docker Server.
- Database: PostgreSQL.
- Scope: one lab only.
- Development mode: local mock API and mock auth adapter.
- Production mode: containerized web/API app connected to PostgreSQL and Imperial-approved SSO.

The production design should avoid platform-specific managed services so the same app can run in Docker on the Imperial VM.

## Suggested Implementation Shape

The scaffold is intentionally split so implementation can start with a mock API and later replace only the auth adapter and deployment wiring.

- `apps/web`: future researcher/admin web UI and app server surface.
- `apps/mock-api`: local API used during development before real services are approved.
- `packages/domain`: shared validation rules, outcome enum, protocol report shapes, and export schema.
- `packages/auth-adapters`: mock, Entra ID OIDC, and Shibboleth/SAML integration boundaries.
- `db`: PostgreSQL schema, migrations, and seed data.
- `infra`: Docker, Red Hat VM, development, staging, production, and identity-provider setup notes.
- `docs`: product planning, ICT SSO notes, privacy/security notes, data export notes, and admin operations.
- `tests`: unit, integration, end-to-end, and security test areas.
- `storage/local-dev`: local-only generated files and test exports.
- `scripts`: future operational/export/admin scripts.

## Open Decisions

1. **Retention periods** for active reports, recycle-bin reports, permanently deleted report tombstones, audit events, backups, and generated exports. Still open; needs the lab and Imperial data protection contacts. Nothing in the app auto-deletes, so no retention rule is silently applied in the meantime.
2. **Recycled records in exports.** Resolved in the implementation as *excluded by default, included only when an admin explicitly ticks "include recycle-bin records"*. Permanently deleted reports are never exportable because their content no longer exists.
3. **Researcher restore and permanent delete.** Implemented as configurable rather than fixed, so the lab can change its mind without a code change: `ALLOW_RESEARCHER_RESTORE` (default true), `ALLOW_RESEARCHER_PERMANENT_DELETE` (default true), and `PERMANENT_DELETE_WAIT_DAYS` (default 0).
4. **Sign-off on the lawful basis and privacy notice wording.** Still open. The agreement text lives in `packages/domain/src/agreement.ts` behind a version string; changing the wording and bumping `AGREEMENT_VERSION` re-prompts every user.
