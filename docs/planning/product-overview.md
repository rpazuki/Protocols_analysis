# Product Overview: Lab Protocols Analysis

## Purpose

Lab Protocols Analysis is a one-lab internal web app for researchers to record daily protocol variations, outcomes, and hypotheses about what went right or wrong. The collected reports will later be exported for analysis, including LLM-assisted pattern finding across successful and failed protocol variations.

This file is the canonical product overview for goals, audiences, roles, workflows, and glossary. Implementation details can live in separate technical documents, but product behaviour should stay aligned with this overview.

## Audiences

- Researchers in the lab who need a low-friction way to record daily protocol variations.
- Lab admins who need to manage protocol types, review records, restore deleted reports, permanently delete records when appropriate, manage admins, and export data.
- Lab leadership and analysis users who will use exported protocol records to identify patterns and tune protocols.
- Imperial ICT and data protection reviewers who need to understand authentication, privacy, deployment, and access-control requirements before production use.

## Goals

- Provide an authenticated landing page where researchers can quickly submit daily protocol reports.
- Use Imperial central authentication in production and a mock internal API/auth path during development.
- Automatically fill the researcher email/username from authentication and make it non-editable.
- Store only the minimum user identity required for attribution and permissions: the authenticated Imperial email address.
- Allow long, unrestricted protocol descriptions and optional outcome hypotheses.
- Let researchers see, edit, copy, delete, restore, and permanently delete their own reports according to the recycle-bin workflow.
- Let researchers create a new report from one of their own previous reports, changing only the date, wording, or fields that differ.
- Prevent accidental exact duplicate submissions where the same researcher submits the same report date and the same main protocol description text.
- Let admins view all reports, manage protocol types, restore recycle-bin records, permanently delete records, manage the admin allowlist, and export data.
- Preserve protocol type labels on reports so historic submissions remain understandable even if admins rename or disable a protocol type later.
- Support CSV and JSONL exports for spreadsheet review and LLM analysis.
- Run on the lab-controlled Imperial Red Hat Linux VM using Docker Server and PostgreSQL.

## Non-Goals For First Release

- Multi-lab tenancy.
- File attachments.
- A public website.
- App-owned password accounts.
- Fuzzy plagiarism/similarity detection.
- Automated protocol recommendation inside the app.
- Direct production connection to Imperial SSO before ICT approval.

## Roles

### Researcher

A signed-in lab user who can create and manage their own protocol reports.

Permissions:

- create a report;
- view own active reports;
- edit own active reports;
- create a new report from an own previous report;
- move own reports to the recycle bin;
- view own recycle bin;
- restore own reports from the recycle bin, unless the lab later chooses admin-only restore;
- permanently delete own recycled reports;
- accept the first-access privacy and use agreement.

Restrictions:

- cannot edit the authenticated email/username;
- cannot view other researchers' reports;
- cannot export all lab data;
- cannot manage protocol types;
- cannot manage admins.

### Admin

A signed-in user whose Imperial email address appears in the admin allowlist.

Permissions:

- all researcher permissions for their own records;
- view all active reports;
- view all recycled reports;
- restore any recycled report;
- permanently delete any recycled report;
- manage protocol types;
- manage the admin allowlist through an admin-only page;
- export reports;
- view audit events if implemented in the admin interface.

Restrictions:

- cannot bypass authentication;
- cannot use mock auth in production;
- should not be able to remove the last admin without a recovery path;
- admin changes and exports must be audited.

### System

The application server and background operational components.

Responsibilities:

- derive researcher email from trusted auth claims;
- enforce all authorization server-side;
- default new report date to today;
- maintain recycle-bin and permanent-delete states;
- check exact duplicate submissions;
- snapshot protocol type labels;
- audit sensitive operations;
- protect production secrets and database access.

## Deployment Context

- Scope: one lab.
- Production host: Imperial-hosted Red Hat Linux VM.
- Runtime: Docker Server.
- Database: PostgreSQL.
- Authentication: Imperial-approved Microsoft Entra ID/OIDC preferred, or Shibboleth/SAML if ICT requires federation through that path.
- Development auth/API: internal mock only.

## Privacy And User Agreement

The app uses the authenticated Imperial email address as the user's app username. That email address is personal data under UK GDPR because it identifies an individual. The app may still store and export it when there is a valid lawful basis and appropriate controls, but it should not describe email storage as having "no GDPR consequences."

On first access, every user must see and accept a privacy and use agreement before using the app.

The first-access agreement should explain:

- the app stores the authenticated Imperial email address as the user's username;
- the email address is attached to protocol reports, audit events, admin changes, and exports where relevant;
- protocol descriptions and hypotheses describe synthetic biology wet-lab procedures and experimental outcomes;
- admins can view and export reports across the lab;
- exports currently include raw email addresses;
- recycle-bin records can be restored or permanently deleted according to the app workflow;
- the relevant privacy notice, lawful basis, retention period, and contact route for questions will be provided before production use.

The agreement should record:

- user email;
- agreement version;
- accepted_at timestamp;
- source application/version if useful.

Product note: this should be implemented as an acknowledgement/privacy-and-use agreement unless Imperial's data protection reviewers explicitly decide that UK GDPR consent is the correct lawful basis. ICO guidance often distinguishes consent to participate or acknowledge terms from consent as the lawful basis for processing personal data, especially where there is a workplace, university, or public-authority power imbalance.

## Core Data

### Protocol Report

- id;
- report date;
- researcher email, derived from authentication;
- protocol type id;
- protocol type label snapshot;
- protocol name;
- free text protocol description;
- outcome: success or failure;
- optional outcome hypothesis;
- creation timestamp;
- update timestamp;
- recycle-bin timestamp, if deleted;
- permanent deletion timestamp or irreversible deletion event, depending on final retention policy;
- restore timestamp, if restored.

### Protocol Type

- id;
- label;
- optional description;
- active/inactive state;
- sort order;
- timestamps.

Protocol type labels are copied onto each report at save time. If an admin later edits the protocol type label, old reports still display the historical label snapshot.

### User Agreement Acceptance

- researcher email;
- agreement version;
- accepted_at;
- accepted_from value if needed for audit/security.

### Admin Allowlist

- admin email;
- created/added timestamp;
- added_by admin email;
- disabled/removed timestamp if soft-managed;
- removed_by admin email if applicable.

Admin access is a **bootstrap config list plus a runtime database allowlist**. Deployment config
(`ADMIN_BOOTSTRAP_EMAILS`) names the admins that must always exist; the running app stores the
editable allowlist in PostgreSQL and admins manage it from an admin-only page. Config entries are
re-applied on every start and cannot be removed in the app, which is the documented break-glass
recovery route. See [admin-management.md](../admin-ops/admin-management.md).

### Audit Event

- actor email;
- action;
- target record type;
- target record id;
- timestamp;
- minimal metadata.

Audit events should cover create, edit, recycle-bin move, restore, permanent delete, protocol-type changes, admin-list changes, agreement acceptance, and exports.

## Workflows

### First Access

1. User opens the app.
2. User authenticates through mock auth in development or Imperial SSO in production.
3. System extracts the user's Imperial email address.
4. System checks whether the current user has accepted the current agreement version.
5. If not accepted, the user sees the privacy and use agreement.
6. User must accept before reaching the report form or admin pages.
7. System records the acceptance event.

### Researcher: Create A New Report

1. Researcher opens the report form.
2. Date defaults to today.
3. Researcher email/username is displayed from authentication and is non-editable.
4. Researcher selects protocol type from the admin-managed dropdown.
5. Researcher enters protocol name.
6. Researcher enters unrestricted free text protocol description.
7. Researcher selects outcome: success or failure.
8. Researcher optionally writes an outcome hypothesis explaining what they think went right or wrong.
9. System checks for an exact duplicate for the same researcher, same report date, and same normalized main protocol description text.
10. If an exact duplicate exists, submission is blocked and the app points to the existing report or recycled item.
11. If no exact duplicate exists, the report is saved with the current protocol type label snapshot.

### Researcher: Create From Previous Report

1. Researcher opens a previous own report.
2. Researcher selects "create from this report."
3. System opens a new unsaved draft prefilled from the previous report.
4. Date defaults to today unless the researcher chooses another date.
5. Researcher changes date, wording, outcome, hypothesis, protocol name, or protocol type as needed.
6. System runs the same exact duplicate check on save.
7. If the date or free text wording differs, the new report is allowed as a repeated or varied protocol.

### Researcher: View And Edit Own Reports

1. Researcher opens their report history.
2. System shows only that researcher's active reports by default.
3. Researcher can filter or search their own reports.
4. Researcher opens a report.
5. Researcher edits allowed fields.
6. System checks authorization and exact duplicate rules before saving.
7. System records an audit event.

### Recycle Bin And Permanent Delete

1. Researcher chooses delete on an own active report.
2. System moves the report to the recycle bin instead of immediately destroying it.
3. Recycled reports disappear from the default active-report view.
4. Researcher can open their recycle bin to review own recycled reports.
5. Admin can open an admin recycle bin to review all recycled reports.
6. From the recycle bin, an authorized user can restore a report.
7. From the recycle bin, an authorized user can permanently delete a report.
8. Permanent deletion should remove the report content from normal application storage. A minimal audit/tombstone event may remain if required for accountability and security.

Final retention rules for permanently deleted records, backups, and audit events must be agreed before production.

### Admin: Protocol Type Management

1. Admin opens protocol type settings.
2. Admin creates, renames, disables, or reorders protocol types.
3. Existing reports keep their protocol type label snapshot.
4. Disabled protocol types no longer appear for new reports but remain visible on historical reports.
5. System records audit events for protocol type changes.

### Admin: Admin Allowlist Management

1. Bootstrap admin is loaded from production config.
2. Signed-in admin opens admin management.
3. Admin adds or removes Imperial email addresses.
4. System validates and normalizes email addresses.
5. System prevents removal of the last admin unless a documented recovery path is used.
6. System records audit events for allowlist changes.

### Admin: Export

1. Admin opens export page.
2. Admin chooses filters such as date range, researcher email, protocol type, outcome, active/recycled/permanently-deleted inclusion rules where applicable.
3. Admin selects CSV or JSONL.
4. System generates the export.
5. Export includes raw researcher email addresses by current requirement.
6. System records an export audit event.

## Exact Duplicate Rule

The duplicate prevention requirement is intentionally exact, not fuzzy.

Default v1 rule:

- scope: same researcher;
- fields compared: report date and main protocol description text only;
- comparison: 100% exact match after minimal normalization;
- blocked state: active reports and recycle-bin reports;
- allowed state: any changed date or changed wording.

The duplicate check does not compare protocol name, protocol type, outcome, or outcome hypothesis.

Minimal normalization should avoid accidental whitespace-only duplicates without becoming fuzzy matching:

- normalize line endings;
- trim leading and trailing whitespace;
- optionally collapse repeated trailing blank lines.

The app should not block two different researchers from writing the same description on the same date, because ownership and lab accountability are per authenticated user.

## Export And Analysis Use

Exports are intended for later analysis of protocol success and failure patterns.

Initial formats:

- CSV for spreadsheet review;
- JSONL for LLM analysis.

Recommended export fields:

- schema version;
- report id;
- report date;
- researcher email;
- protocol type id;
- protocol type label snapshot;
- protocol name;
- description text;
- outcome;
- outcome hypothesis;
- created at;
- updated at;
- recycle-bin/deletion state where applicable.

## Glossary

- Active report: a report visible in normal researcher/admin views.
- Admin: a signed-in user whose email address is in the admin allowlist.
- Admin allowlist: the configured list of email addresses with admin rights.
- Agreement version: the versioned first-access privacy and use acknowledgement text.
- Auth claim: a trusted field released by the authentication provider, such as email.
- Exact duplicate: a report from the same researcher with the same date and same normalized main protocol description text.
- Imperial SSO: Imperial College's central sign-on infrastructure, through Microsoft Entra ID/OIDC or Shibboleth/SAML depending on ICT approval.
- Mock auth: local development-only authentication that simulates signed-in users.
- Outcome: success or failure.
- Outcome hypothesis: optional free text explaining what the researcher thinks went right or wrong.
- Permanent delete: final delete action from the recycle bin, subject to agreed retention, audit, and backup rules.
- Protocol description: the main unrestricted free text field describing the protocol variation.
- Protocol report: one submitted record of a protocol variation and its outcome.
- Protocol type: an admin-managed dropdown category.
- Protocol type label snapshot: the protocol type label copied onto a report when it is saved.
- Recycle bin: the holding area where deleted reports can be restored or permanently deleted.
- Researcher: a signed-in lab user recording protocols.
- Researcher email: the authenticated Imperial email address used as the app username.
- Soft delete: moving a report from active state to the recycle bin.

## Open Decisions

1. What retention period applies to active reports, recycle-bin reports, permanently deleted report tombstones, audit events, backups, and generated exports?
2. Should researchers be able to restore their own recycled reports, or should restore be admin-only?
3. Should permanent deletion be available immediately from the recycle bin, or only after a waiting period?
4. Who signs off the final privacy notice and agreement text before production?
