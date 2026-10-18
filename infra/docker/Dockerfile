# Lab Protocols Analysis - production image.
#
# Multi-stage so the runtime image carries only the Next.js standalone output:
# no package manager, no build toolchain, no application source. Targets Docker
# Server on the Imperial-hosted Red Hat VM (infra/environments/production).
#
# Node 24 runs the TypeScript operational scripts directly, without a build step.

ARG NODE_IMAGE=node:24-bookworm-slim

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# Manifests first, so a source-only change does not re-run npm ci.
COPY package.json package-lock.json ./
COPY packages/domain/package.json                        packages/domain/
COPY packages/db/package.json                            packages/db/
COPY packages/auth-adapters/core/package.json            packages/auth-adapters/core/
COPY packages/auth-adapters/mock/package.json            packages/auth-adapters/mock/
COPY packages/auth-adapters/entra-oidc/package.json      packages/auth-adapters/entra-oidc/
COPY packages/auth-adapters/shibboleth-saml/package.json packages/auth-adapters/shibboleth-saml/
COPY apps/web/package.json                               apps/web/
COPY apps/mock-api/package.json                          apps/mock-api/

RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The production assertions in apps/web/src/server/config.ts are deferred while
# NEXT_PHASE is set, so no runtime secret is needed to build the image.
ENV NODE_ENV=production
ENV NEXT_PHASE=phase-production-build
RUN npm run build --workspace apps/web

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# The standalone bundle already carries its traced runtime dependencies
# (including pg) in /app/node_modules.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
# Next inlines zod into the web bundle, but operational TypeScript scripts
# import the domain package directly and still need its runtime dependency.
COPY --from=deps --chown=node:node /app/node_modules/zod ./node_modules/zod

# Migrations, seeds, and the operational scripts travel with the image so a VM
# admin can run them with `docker compose run --rm app node scripts/...`
# without needing a source checkout on the VM.
COPY --from=build --chown=node:node /app/db ./db
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/packages ./packages

# The scripts import the workspace packages by name. The standalone bundle
# inlines them for the web server but leaves no resolvable module, so recreate
# the workspace links npm would have made.
RUN mkdir -p node_modules/@protocols \
 && ln -sfn /app/packages/domain                        node_modules/@protocols/domain \
 && ln -sfn /app/packages/db                            node_modules/@protocols/db \
 && ln -sfn /app/packages/auth-adapters/core            node_modules/@protocols/auth-core \
 && ln -sfn /app/packages/auth-adapters/mock            node_modules/@protocols/auth-mock \
 && ln -sfn /app/packages/auth-adapters/entra-oidc      node_modules/@protocols/auth-entra-oidc \
 && ln -sfn /app/packages/auth-adapters/shibboleth-saml node_modules/@protocols/auth-shibboleth-saml \
 && chown -R node:node node_modules/@protocols

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/protocols/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
