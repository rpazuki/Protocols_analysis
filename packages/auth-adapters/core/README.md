# Auth Adapter Core

The authentication trust boundary. Every adapter implements `AuthAdapter` and returns `AuthClaims`:

```ts
interface AuthClaims {
  email: string;        // normalized; becomes researcher_email
  subject: string;      // provider subject, for session binding and audit
  issuer: string;       // IdP identifier, for audit
  credentialVersion?: number; // local password revision for session invalidation
  displayLabel?: string | null;
  logoutHint?: string | null;
}
```

Nothing else an identity provider releases crosses this boundary. That is the data-minimisation commitment in [gdpr-position.md](../../../docs/privacy-security/gdpr-position.md) expressed as a type.

Shared helpers:

- `extractEmail()` tries the configured claim then the conventional fallbacks, and **throws rather than guessing**. An app that mis-attributes a report is worse than one that fails to sign a user in.
- `assertAllowedDomain()` refuses a successfully authenticated user from outside `ALLOWED_EMAIL_DOMAINS`, so a mis-scoped app registration cannot open the lab record to a wider tenant.

`AUTH_ADAPTER=local` selects the production-capable password adapter in the web
server. See [local account operations](../../../docs/admin-ops/local-authentication.md).
