# Shibboleth SAML Adapter

Production alternative, selected with `AUTH_ADAPTER=shibboleth-saml`. Use if ICT prefers institutional federation. Imperial appears in the UK federation IdP list with entityID `https://shibboleth.imperial.ac.uk/shibboleth`.

## How it works: service-provider proxy mode

A Shibboleth SP (`shibd` plus `mod_shib` in Apache, or the equivalent in the VM's reverse proxy) terminates SAML in front of this app and releases the approved attributes as request headers. The app never parses XML, never handles the SP signing key, and never tracks federation metadata refreshes — which is also how Imperial ICT normally expects an SP to be deployed.

## Security requirement

Header-based identity is only safe when the app cannot be reached except through that SP: otherwise anyone who can reach the container can forge an attribute header and become any user.

Two guards enforce this, and both are tested:

1. The proxy must inject `SHIBBOLETH_PROXY_SECRET` on every request. Without a matching value the adapter refuses the request. The adapter will not even construct without a secret configured.
2. An SP session header must be present, so an unauthenticated pass-through cannot mint a session.

**Bind the app container to loopback** (the production compose file does) and let only the SP reach it.

## Configuration

| Variable | Default |
| --- | --- |
| `SHIBBOLETH_PROXY_SECRET` | required, no default |
| `SHIBBOLETH_PROXY_HEADER_NAME` | `x-sp-proxy-secret` |
| `SHIBBOLETH_EMAIL_HEADER` | `mail` — confirm with ICT, it may be `eppn` |
| `SHIBBOLETH_SESSION_HEADER` | `shib-session-id` |
| `SHIBBOLETH_SUBJECT_HEADER` | `persistent-id` |
| `SHIBBOLETH_IDP_ENTITY_ID` | Imperial's federation entityID |
| `SHIBBOLETH_LOGIN_PATH` / `SHIBBOLETH_LOGOUT_PATH` | `/Shibboleth.sso/Login`, `/Shibboleth.sso/Logout` |

Multi-valued attributes arrive semicolon-joined and percent-escaped; the adapter takes the first value and unescapes it.

If ICT requires the application itself to speak SAML rather than sitting behind an SP, that is a new adapter behind the same `AuthAdapter` interface — nothing outside this package changes.
