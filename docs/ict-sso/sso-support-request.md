# Imperial ICT SSO Support Request

This is a draft request for Imperial ICT to review and enable central single sign-on for a multi-application lab gateway hosted on an Imperial-managed VM.

## Request Summary

Please advise on and support connecting an internally hosted lab web-app gateway to Imperial College London's central single sign-on infrastructure.

Requested public access point:

`https://rlalab-assist.dept.ic.ac.uk/`

The VM is reachable only from the Imperial VPN/Zscaler environment. The aim is to expose one HTTPS entry point on ports 80 and 443, then route internally to three separate web applications by path:

| Public path | Application | Current auth model |
| --- | --- | --- |
| `/protocols` | Protocols | Needs Imperial SSO for production |
| `/biopipeline` | bioPipeline | Internal user management today |
| `/assist` | rlalab-assist | Internal user management today |

Port `80` should redirect to `443`. Application containers may still listen on internal ports such as `3000`, `3001`, `3002`, or `8080`, but those backend ports should not be exposed directly to users or registered as public SSO callback URLs.

Preferred SSO model: a **single gateway-level SSO integration** for `rlalab-assist.dept.ic.ac.uk`, with the gateway/reverse proxy authenticating users and forwarding only approved identity information to SSO-enabled apps.

Preferred identity protocol: **Microsoft Entra ID / OpenID Connect**, if ICT supports gateway-level OIDC for this VM.

Acceptable alternative: **Shibboleth / SAML** with a Shibboleth Service Provider or equivalent reverse proxy in front of the application paths.

The gateway approach lets the lab use one access point, one TLS certificate, and one initial SSO support request. Protocols can use SSO immediately. The two existing apps can continue using internal user management behind the same HTTPS/VPN gateway, and one of them can later migrate to the same SSO gateway without changing the public host.

Companion documents:

- [Multi-App Gateway Solution](../deployment/multi-app-gateway-solution.md)
- [Multi-Path App Porting Guide For Agents](../deployment/multi-path-app-porting-guide.md)
- [TLS Certificate Request Notes](tls-certificate-request.md)

## Copy-Paste ICT Ticket Text

Hello ICT,

Please route this to the team responsible for institutional SSO / Entra ID / Shibboleth application integrations.

We need support connecting an Imperial-managed Red Hat Linux VM gateway to Imperial SSO.

Public URL: `https://rlalab-assist.dept.ic.ac.uk/`

The VM is reachable only via Imperial VPN/Zscaler. It will use one HTTPS gateway on port `443`, with port `80` redirecting to HTTPS. Backend Docker app ports will be internal only.

Applications behind the gateway:

- `/protocols` - Protocols; requires Imperial SSO for production.
- `/biopipeline` - bioPipeline; uses internal user management today.
- `/assist` - rlalab-assist; uses internal user management today.

Preferred model: one gateway-level SSO integration for `rlalab-assist.dept.ic.ac.uk`, using Entra ID / OpenID Connect if possible. Shibboleth / SAML SP proxy mode is also acceptable if that is Imperial's standard route.

Proposed gateway OIDC callback:

`https://rlalab-assist.dept.ic.ac.uk/sso/callback`

Fallback app-level OIDC callback for Protocols:

`https://rlalab-assist.dept.ic.ac.uk/protocols/auth/callback`

Protocols needs only the user's primary Imperial email address as a trusted username. It does not need display name, department, staff/student number, group membership, profile photo, or Microsoft Graph access for the initial release.

Please confirm:

1. Recommended SSO model: gateway OIDC, app-level OIDC, or Shibboleth/SP proxy.
2. Required redirect/callback URLs, entity IDs, metadata, and client credentials.
3. The claim or attribute to use as the canonical Imperial email username.
4. Any reverse-proxy requirements for forwarded identity headers.
5. Whether a staging/test SSO registration is required.
6. Whether the SSO request should be handled together with, or separately from, the TLS certificate request for this hostname.

Privacy/data note: Protocols stores the authenticated Imperial email address as the user's app username and attaches it to protocol reports, audit events, and admin exports. In SSO mode it requires no local password and stores no extra SSO profile data. An optional separately configured local-login mode stores salted password hashes and login-security state; it does not collect Imperial SSO credentials. A first-access privacy/use agreement tells users that their Imperial email address is stored.

## Gateway And Application Details

| Field | Value |
| --- | --- |
| Gateway name | RLA Lab Apps Gateway |
| Initial SSO-enabled app | Protocols |
| Owning group | RLA lab / Bezos Centre project team |
| Hosting model | Imperial-hosted Red Hat Linux VM |
| Network exposure | VPN/Zscaler only |
| Public URL requested | `https://rlalab-assist.dept.ic.ac.uk/` |
| Public ports requested | `80` redirecting to `443`; `443` serving HTTPS |
| Internal backend ports | App-specific, for example `3000`, `3001`, `3002`, or `8080`; not public |
| Runtime | Docker Server |
| Database | PostgreSQL |
| Operating system | Red Hat Linux |
| Web frameworks | Node.js / Next.js and similar Node web stacks |
| Expected users | Members of one Imperial research lab |
| Access model | Gateway authenticates where SSO is enabled; each app owns its own authorization model |

## Proposed Public Routes

| Route | Purpose | SSO at launch |
| --- | --- | --- |
| `/` | Gateway landing/index page or redirect to a default app | Optional |
| `/protocols` | Protocols | Yes |
| `/biopipeline` | bioPipeline | No, unless later migrated |
| `/assist` | rlalab-assist | No, unless later migrated |
| `/sso/callback` | Proposed OIDC gateway callback if Entra gateway SSO is used | Gateway-owned |
| `/Shibboleth.sso/*` | Shibboleth SP endpoints if SAML is used | Gateway-owned |

## If Microsoft Entra ID / OIDC Is Approved

Preferred model: a gateway-level confidential web application registration.

Requested settings:

| Item | Requested value / note |
| --- | --- |
| Application type | Server-side web application / confidential client |
| Tenant scope | Imperial-only / single tenant, unless ICT advises otherwise |
| Public host | `https://rlalab-assist.dept.ic.ac.uk/` |
| Gateway redirect URI | `https://rlalab-assist.dept.ic.ac.uk/sso/callback`, or ICT-approved equivalent for the gateway software |
| App-level fallback redirect URI | `https://rlalab-assist.dept.ic.ac.uk/protocols/auth/callback` |
| Post-logout redirect URI | `https://rlalab-assist.dept.ic.ac.uk/` |
| Flow | Authorization code flow with PKCE where supported by the gateway/app |
| Scopes | `openid profile email` |
| API permissions | No Microsoft Graph permissions requested for Protocols |
| Required user claim | Primary Imperial email address, preferably in `email`; app can be configured to use another confirmed claim such as `mail` or `upn` |
| Roles/groups | Not required for Protocols. Admin status is managed inside the app database. |
| MFA / Conditional Access | Use Imperial's normal account protections and MFA/passkey policy |

Values needed from ICT:

- Tenant issuer/authority, for example `https://login.microsoftonline.com/<tenant-id>/v2.0`.
- Application/client ID.
- Client secret or certificate-based credential approach.
- Confirmed redirect URI policy.
- Confirmed logout URI policy.
- Confirmed email claim name.
- Any token lifetime/session requirements.
- Whether one gateway registration can cover current and future SSO-enabled paths on the same host.
- Test users or a test access process for pre-production validation.

## If Shibboleth / SAML Is Preferred

The gateway can run a Shibboleth Service Provider or equivalent SP proxy. The SP terminates SAML, protects selected paths, and forwards only approved attributes to backend apps.

Proposed values for ICT review:

| Item | Proposed value / note |
| --- | --- |
| Public service URL | `https://rlalab-assist.dept.ic.ac.uk/` |
| Initial protected path | `/protocols` |
| Proposed SP entityID | `https://rlalab-assist.dept.ic.ac.uk/shibboleth` |
| Proposed ACS URL | `https://rlalab-assist.dept.ic.ac.uk/Shibboleth.sso/SAML2/POST` |
| Imperial IdP entityID currently assumed | `https://shibboleth.imperial.ac.uk/shibboleth` |
| Required attribute | Primary Imperial email address, preferably `mail`; app can be configured if ICT releases `eppn` or another email-bearing attribute instead |
| Optional attribute | Persistent subject identifier, if ICT wants one for SSO traceability. It is not stored as the app username. |
| Attributes not needed | Display name, department, job title, groups, phone number, or profile photo |

Values needed from ICT:

- Confirmed Imperial IdP metadata URL or metadata file.
- Confirmed SP entityID.
- Confirmed Assertion Consumer Service URL and binding.
- Certificate/key handling requirements for the SP.
- Attribute release approval and exact attribute/header names.
- Logout/session handling expectations.
- Whether ICT will provide/configure the Shibboleth SP, or whether the lab should configure it on the VM under ICT guidance.
- Reverse-proxy requirements for stripping client-supplied identity headers before injecting trusted SP headers.

Security requirement for this path: SSO-enabled apps must not be directly reachable except through the trusted gateway. Backend containers should bind to loopback or a private Docker network only.

## Privacy And Data Minimisation For Protocols

Protocols stores the authenticated Imperial email address as the user's username. This is personal data and is treated as such.

Protocols does not store:

- Imperial password or passkey data;
- Microsoft/Shibboleth tokens after the app session is created;
- display name;
- department;
- employee/student number;
- profile photo;
- group membership.

Protocols does store:

- normalized Imperial email address for report attribution and permissions;
- protocol reports entered by the researcher;
- agreement acceptance records;
- audit events for sensitive actions;
- local admin allowlist and researcher denylist entries.

Controls already built into Protocols:

- The user email is derived from trusted SSO claims and is non-editable in the UI.
- Researchers can view and edit only their own reports.
- Admins are managed through a local database allowlist, bootstrapped from deployment configuration.
- Named users can be blocked through a local denylist if they should no longer access the app.
- A first-access privacy/use agreement explains that the Imperial email address is stored and attached to reports, audit records, and exports.
- Exports are admin-only, audited, and include warnings that raw email addresses are personal data.
- Production mock authentication is refused.
- Production requires HTTPS and signed `httpOnly` session cookies.

## Information Still Needed From The Lab

Before submitting, fill in or confirm:

- named service owner;
- technical contact;
- lab/department name as ICT should record it;
- expected approximate number of users;
- final public paths for bioPipeline and rlalab-assist, if ICT prefers different names from `/biopipeline` and `/assist`;
- whether a staging URL is available or needed;
- whether the lab wants only a single-host certificate for `rlalab-assist.dept.ic.ac.uk`, or a scoped wildcard/SAN certificate for future subdomain flexibility;
- preferred gateway software if already chosen, for example nginx, Apache, Caddy, Traefik, oauth2-proxy, mod_auth_openidc, or Shibboleth SP.

## Sources Checked

- [Imperial ICT Service Desk](https://www.imperial.ac.uk/admin-services/ict/contact-ict-service-desk/): requests and support should go through ASK / ICT Service Desk.
- [Imperial Office 365 guidance](https://www.imperial.ac.uk/admin-services/ict/self-service/connect-communicate/office-365/): Imperial users sign in with an Imperial username followed by `@ic.ac.uk`.
- [Imperial authentication methods guidance](https://www.imperial.ac.uk/admin-services/ict/self-service/be-secure/passwords-and-extra-security/multi-factor-authentication/): Imperial account authentication uses MFA/passkeys.
- [Microsoft Entra ID OIDC documentation](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc): OIDC enables SSO with ID tokens and tenant-scoped discovery under `https://login.microsoftonline.com/{tenant}/v2.0`.
- [Microsoft Entra redirect URI documentation](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url): redirect URIs must use HTTPS outside localhost and must match registered URLs exactly, including path and port.
- [Microsoft guidance for web apps behind proxies](https://learn.microsoft.com/en-us/entra/msidweb/advanced/web-apps-behind-proxies): proxy deployments must handle path-based routing, TLS termination, custom domains, and redirect URI construction carefully.
- [Microsoft Entra application proxy FAQ](https://learn.microsoft.com/en-us/entra/identity/app-proxy/application-proxy-faq): nonstandard ports are acceptable internally, but external HTTPS publication is normally on 443.
- [NGINX reverse proxy documentation](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy): a reverse proxy can expose one public endpoint and route requests to backend HTTP services.
- [Shibboleth SP metadata documentation](https://shibboleth.atlassian.net/wiki/spaces/CONCEPT/pages/928645420/MetadataForSP): SAML SP metadata identifies the SP entityID and Assertion Consumer Service endpoint.
