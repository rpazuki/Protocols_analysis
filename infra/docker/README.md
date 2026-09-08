# Docker Image

Multi-stage build producing a runtime image with no package manager, no build toolchain, and no application source — only the Next.js standalone bundle and its traced dependencies.

```bash
docker build -f infra/docker/Dockerfile -t protocols-analysis:latest .
```

Notes:

- **Manifests are copied before source**, so a code change does not re-run `npm ci`.
- **The build sets `NEXT_PHASE=phase-production-build`**, which defers the production config assertions. No runtime secret is needed to build the image.
- **Migrations, seeds, and the operational scripts are included**, so a VM admin can run them with `docker compose run --rm --entrypoint node app scripts/...` without a source checkout. The workspace symlinks under `node_modules/@protocols` are recreated for them, because the standalone bundle inlines those packages for the web server and leaves no resolvable module.
- **Runs as the unprivileged `node` user.**
- **Healthcheck** hits `/api/health`, which reports database reachability and nothing else.

Node 24 runs the TypeScript operational scripts directly, so there is no separate build step for them.
