# Web App

Next.js App Router UI and server surface for researchers and lab admins.

## Layout

```
src/app/            routes
  auth/             sign-in, mock persona picker (dev only), IdP callback, sign-out
  agreement/        first-access privacy and use agreement gate
  reports/          new, list, detail, edit, recycle bin
  admin/            all reports, protocol types, admins, access denylist, recycle bin, audit, export
  access-denied/    shown to an authenticated user whose access has been withdrawn
  api/health/       unauthenticated liveness probe
src/server/         server-only code
  config.ts         environment reading and production preconditions
  auth/             adapter selection, session cookie, principal resolution
  actions/          server actions (every mutation)
  audit.ts          audit event writer
src/components/     shared UI
```

## Rules this app is responsible for


## Development

Run from the repository root:

```bash
npm run dev
```
The app is deployed as the `/protocols` tenant behind the shared lab gateway:
`https://rlalab-assist.dept.ic.ac.uk/protocols`. Set `APP_BASE_PATH` and
`NEXT_PUBLIC_BASE_PATH` to another prefix only when deploying this app in a
different route.

Local development uses `http://localhost:3000/protocols` by default. Build the
gateway-shaped production bundle with:

```bash
NEXT_PUBLIC_BASE_PATH=/protocols APP_BASE_PATH=/protocols npm run build --workspace @protocols/web
```

The root `.env` is loaded by `next.config.ts`, because Next only reads `.env` from the app directory and this repo keeps one at the root.

The root `.env` is loaded by `next.config.ts`, because Next only reads `.env` from the app directory and this repo keeps one at the root.
