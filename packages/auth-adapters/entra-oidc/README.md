# Entra ID OIDC Adapter

Production-preferred adapter, selected with `AUTH_ADAPTER=entra-oidc`. Inert until Imperial ICT approves an application registration.

Implements the OpenID Connect authorization-code flow with PKCE:

1. OIDC discovery against `${ENTRA_ISSUER}/.well-known/openid-configuration`.
2. Redirect to the authorization endpoint with `state`, `nonce`, and an S256 code challenge. Those values are stored in a signed, httpOnly, SameSite=Lax cookie.
3. Server-side code exchange using the client secret.
4. `id_token` signature verified against the tenant JWKS, with issuer and audience checks; `state` and `nonce` compared against the stored transaction.
5. The email claim is extracted, lowercased, and becomes `researcher_email`. Nothing else the tenant releases is carried into the app.

## Configuration

| Variable | Notes |
| --- | --- |
| `ENTRA_ISSUER` | e.g. `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| `ENTRA_CLIENT_ID` | from the ICT app registration |
| `ENTRA_CLIENT_SECRET` | required in production; keep it out of source control |
| `ENTRA_REDIRECT_URI` | must match the registration exactly; defaults to `${APP_URL}/auth/callback` |
| `ENTRA_SCOPES` | defaults to `openid,profile,email` |
| `ENTRA_EMAIL_CLAIM` | the claim ICT confirms carries the Imperial address |
| `ALLOWED_EMAIL_DOMAINS` | optional guard, so a mis-scoped registration cannot open the app to a wider tenant |

Ask ICT for the items listed in [identity-integration.md](../../../docs/ict-sso/identity-integration.md), in particular which claim carries the email address and whether the registration is single- or multi-tenant.
