# Identity Integration Plan

The app must use Imperial's centralised authentication in production and a mock provider in development.

## Development

- Use the mock auth adapter only in local/development environments.
- Mock claims should include:
  - email;
  - display label if useful for development only;
  - role/admin flag derived from the local config allowlist.
- Mock users must be obvious in the UI and logs.
- Production builds should fail or refuse to start if mock auth is selected.

## Production Preferred Path: Microsoft Entra ID / OIDC

Use this if Imperial ICT approves an application registration.

Information needed from ICT:

- tenant authority/issuer;
- client ID;
- client secret or certificate approach;
- redirect URI policy;
- logout URI policy;
- required scopes;
- email claim source;
- group/role claim availability, if any;
- MFA/conditional access expectations;
- token lifetime/session requirements;
- test users and staging approval process.

The app should extract and normalize the Imperial email address from trusted claims. The email must be non-editable in the UI.

## Production Alternative: Shibboleth / SAML

Use this if ICT prefers institutional federation/SAML.

Known public metadata clue:

- Imperial College London appears in the UK federation IdP list with entityID `https://shibboleth.imperial.ac.uk/shibboleth`.

Information needed from ICT:

- IdP metadata URL or metadata file;
- SP entity ID for this app;
- assertion consumer service URL;
- certificate/key handling;
- required attributes;
- email attribute name;
- logout/session handling;
- test/staging process;
- attribute release approval.

## Authorization

Authentication proves identity. Authorization remains app-owned:

- Researchers can access only their own reports.
- Admin status is determined by the admin config allowlist.
- Admin config changes require an existing admin session.
- Admin config changes must be audited.
- All checks must happen server-side.


## As Implemented

The adapter boundary is [`packages/auth-adapters/core`](../../packages/auth-adapters/core/README.md). An adapter returns only a normalized email, a provider subject, and an issuer; nothing else the IdP releases crosses into the app. `AUTH_ADAPTER` selects which one runs.

| Adapter | Status |
| --- | --- |
| [mock](../../packages/auth-adapters/mock/README.md) | complete, development only, refused in production four different ways |
| [entra-oidc](../../packages/auth-adapters/entra-oidc/README.md) | complete: authorization code + PKCE, discovery, JWKS `id_token` verification, state and nonce checks. Inert until ICT supplies issuer, client id, and secret |
| [shibboleth-saml](../../packages/auth-adapters/shibboleth-saml/README.md) | complete in service-provider proxy mode: an SP terminates SAML in front of the app and releases attributes as headers, guarded by a shared proxy secret |

**Why SP proxy mode for Shibboleth.** It is how Imperial ICT normally expects an SP to be deployed, and it keeps XML parsing, the SP signing key, and federation metadata refreshes out of the application. If ICT requires the app itself to speak SAML, that is a new adapter behind the same interface; nothing outside `packages/auth-adapters` changes.

**Still needed from ICT** — the lists above are unchanged. The two answers that matter most on day one are which claim or attribute carries the Imperial email address (`ENTRA_EMAIL_CLAIM` / `SHIBBOLETH_EMAIL_HEADER`), and the approved redirect or assertion-consumer URI.

### Authorization, as implemented

Authentication proves identity; authorization stayed app-owned, as planned.

- Imperial SSO proves identity for the whole institution, which is wider than lab membership. The app closes that gap with a denylist rather than an allowlist: everyone authenticated may use the app until an admin blocks them. `ALLOWED_EMAIL_DOMAINS` narrows this at the domain level; see [admin-management.md](../admin-ops/admin-management.md) for the reasoning and the trade-off.
- A blocked account is refused *after* authentication succeeds, so the person is told this app withdrew their access rather than that their Imperial login failed. That distinction matters for the ICT service desk.
- Researchers reach only their own reports. The ownership scope is applied in the repository query, not in the page, and an explicit `researcherEmail` filter cannot widen it.
- Admin status is read from the database allowlist **on every request**, never carried in the session cookie, so removing an admin takes effect immediately.
- Every mutation is a server action that re-derives the principal from the session and re-checks authorization against the freshly loaded row.
- Admin changes and denied admin access attempts are audited.
- `ALLOWED_EMAIL_DOMAINS` optionally refuses a successfully authenticated user from outside the approved domains, so a mis-scoped app registration cannot open the lab record to a wider tenant.

## Optional local login while SSO is pending

`AUTH_ADAPTER=local` is a separate production-capable email/password adapter.
It uses administrator-provisioned accounts rather than asserting an arbitrary
identity. SSO-specific instructions above apply to the SSO adapters; mock auth
remains development-only. See [local authentication](../admin-ops/local-authentication.md)
for migration, account lifecycle, data stored and switching to SSO.
