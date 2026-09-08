# Multi-App Gateway Solution

## Recommendation

Run the three web applications behind one HTTPS gateway on the VM:

```text
VPN/Zscaler users
  -> https://rlalab-assist.dept.ic.ac.uk/
    -> gateway reverse proxy on ports 80 and 443
      -> /protocols    -> Protocols, internal port 3000
      -> /biopipeline  -> bioPipeline, internal port 3001
      -> /assist       -> rlalab-assist, internal port 3002
      -> /sso/*        -> gateway SSO callback/session endpoints, if used
```

The apps stay separate services. They should not be merged into one codebase just to share TLS or SSO. The shared component is the **access layer**: DNS, TLS, reverse proxy routing, and optional SSO enforcement.

Port `80` should only redirect to HTTPS on `443`. Backend app ports such as `3000`, `3001`, `3002`, or `8080` should be bound to loopback or a private Docker network and never exposed directly to users.

## Why This Fits The Lab

Path routing is a good fit because:

- there is one VM and one lab;
- the apps are under your source and deployment control;
- all apps can be adjusted to run below a path prefix;
- one hostname is simpler for VPN-only access;
- one TLS certificate is enough for the public entry point;
- Protocols can use SSO first while the other apps keep internal user management;
- a second app can later move behind the same SSO gateway without changing the public host.

The trade-off is that each app must become a polite path tenant. It must generate links, redirects, cookies, assets, callback URLs, and API calls below its own prefix. For Next.js apps this is manageable, but it must be tested deliberately.

## Public Route Plan

| Public route | Backend | Auth at launch | Notes |
| --- | --- | --- | --- |
| `/` | gateway landing page | optional | Can list apps or redirect to `/protocols`. |
| `/protocols` | Protocols | Imperial SSO | Main app requiring ICT approval. |
| `/biopipeline` | bioPipeline | internal auth today | Can later move to SSO. |
| `/assist` | rlalab-assist | internal auth today | Can later move to SSO. |
| `/sso/*` | gateway auth component | gateway-owned | Used only if Entra/OIDC gateway is chosen. |
| `/Shibboleth.sso/*` | Shibboleth SP | gateway-owned | Used only if Shibboleth is chosen. |

Use semantic public paths rather than placeholders. Keep `/` as a small gateway landing page unless `rlalab-assist` truly needs to own the host root. The app named `rlalab-assist` should use `/assist` as its canonical path to avoid the awkward repeated URL `https://rlalab-assist.dept.ic.ac.uk/rlalab-assist`.

## SSO Models

### Preferred: Gateway-Level SSO

The gateway authenticates the user once using Imperial SSO, then forwards trusted identity only to apps that have opted into SSO.

```text
Browser
  -> gateway
    -> Entra OIDC or Shibboleth SP
      -> trusted identity headers
        -> /protocols backend
```

Advantages:

- one SSO request can cover the gateway;
- one callback endpoint can serve the access layer;
- each app can migrate to SSO gradually;
- identity enforcement is centralized;
- backend apps do not each need their own client secret or federation metadata.

Requirements:

- The gateway must strip all client-supplied identity headers before injecting trusted ones.
- SSO-enabled backend apps must be unreachable except through the gateway.
- The forwarded identity contract must be small and stable, preferably just the normalized Imperial email address plus a provider session marker.
- Apps must still enforce local authorization themselves. SSO proves identity; it does not decide app roles.

For Protocols, Shibboleth SP proxy mode already matches this pattern. If ICT chooses an Entra/OIDC gateway rather than app-level OIDC, add a generic trusted-header auth adapter or map the gateway headers to the existing Shibboleth-style header adapter with the same shared-secret protection.

### Fallback: App-Level OIDC Under Path Prefixes

Each SSO-enabled app handles its own OIDC callback, for example:

`https://rlalab-assist.dept.ic.ac.uk/protocols/auth/callback`

This still works behind the shared TLS gateway. It is also simpler if ICT expects the app to own the OIDC flow. The downside is that every SSO-enabled app needs registered redirect URIs and client credential handling. ICT may allow multiple redirect URIs in one application registration, but sharing one client registration across unrelated apps is a weaker security boundary than a gateway SSO component or separate registrations.

## TLS Certificate Choice

For path routing, a normal single-host certificate for:

`rlalab-assist.dept.ic.ac.uk`

is sufficient.

A wildcard certificate is not needed for the path-routing plan. It becomes useful only if the lab later wants subdomains such as:

- `biopipeline.rlalab-assist.dept.ic.ac.uk`
- `assist.rlalab-assist.dept.ic.ac.uk`
- `protocols.rlalab-assist.dept.ic.ac.uk`

If ICT says a wildcard or SAN certificate is easy, keep the scope narrow. A certificate for `*.rlalab-assist.dept.ic.ac.uk` is a reasonable future-flexibility request if that subdomain can be delegated. A broad wildcard for a whole department domain would be unnecessarily wide for this project.

The Imperial-specific certificate request details are in [TLS Certificate Request Notes](../ict-sso/tls-certificate-request.md).

## Reverse Proxy Shape

Use nginx, Apache, Caddy, Traefik, or an ICT-standard equivalent. The important behavior is the same:

```text
listen 80
  redirect all requests to https://rlalab-assist.dept.ic.ac.uk$request_uri

listen 443 ssl
  /protocols/   -> http://127.0.0.1:3000/protocols/
  /biopipeline/ -> http://127.0.0.1:3001/biopipeline/
  /assist/      -> http://127.0.0.1:3002/assist/
```

Prefer preserving the path prefix when proxying to each app. That lets the app know its public route and use its framework's base-path support. Stripping the prefix can work, but it often creates fragile redirects, callback URLs, asset paths, and cookie paths.

The gateway should set standard proxy headers such as:

- `Host`
- `X-Forwarded-For`
- `X-Forwarded-Proto`
- `X-Forwarded-Host`

Application security code must not blindly trust these headers for authorization. They are useful for logs and framework URL generation only after the proxy has stripped/overwritten client-supplied versions.

## Good-Tenant Rules For Each App

Each application should:

- have a unique public base path, for example `/protocols`;
- have a unique internal port;
- set cookies with a path limited to its base path;
- use unique cookie names even if paths are isolated;
- generate links and redirects below its base path;
- keep static assets below its base path;
- keep API routes below its base path;
- expose health checks either internally only or below its own path;
- avoid global routes such as `/auth/*`, `/api/*`, or `/_next/*` at the gateway root;
- avoid global response headers that could weaken another app;
- keep database schemas, users, migrations, and backups separable even if they share the same PostgreSQL server;
- log enough to identify the path/app that handled each request.

## Database And Operations

Sharing one PostgreSQL server is acceptable. Sharing one database user across apps is not ideal.

Recommended:

- one PostgreSQL instance;
- separate database or schema per app;
- separate database role/password per app;
- separate migration command per app;
- separate backup/restore checklist per app;
- one VM-level backup policy that covers the whole service;
- one gateway access log, plus per-app application logs.

The gateway should have a small status page or internal runbook showing which backend port maps to which public path. That will save time during an incident.

## Security Notes

VPN/Zscaler access is a network control, not a substitute for application authentication.

Keep:

- HTTPS in production;
- SSO for Protocols before real protocol data is entered;
- internal app ports closed to users;
- identity headers stripped at the gateway;
- backend containers reachable only from the gateway;
- per-app authorization inside each app;
- app-specific secrets and cookie names;
- `Cache-Control: no-store` on sensitive app pages and exports;
- audit logging inside apps for sensitive actions.

Protocols should continue to treat Imperial email addresses as personal data and should keep its first-access agreement.

## Decision

Use path routing on one host:

`https://rlalab-assist.dept.ic.ac.uk/`

Run Protocols at:

`https://rlalab-assist.dept.ic.ac.uk/protocols`

Ask ICT for one gateway-level SSO integration if they support it. Keep app-level OIDC at `/protocols/auth/callback` as a documented fallback.
