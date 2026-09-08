# Development Environment

Docker for PostgreSQL, the app on the host, mock auth enabled. See [infra/local](../../local/README.md) for the commands.

No real Imperial SSO secrets are required, and none should be present. `AUTH_ADAPTER=mock` is the default; the app refuses to start with it when `NODE_ENV=production`.

Nothing here should hold real lab protocol data.
