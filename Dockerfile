# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
FROM base AS dependencies
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# next build includes TypeScript validation. CI runs the behaviour tests once.
RUN npm run build
FROM base AS runtime
ARG APP_REVISION=local
ENV APP_REVISION=$APP_REVISION
LABEL org.opencontainers.image.revision=$APP_REVISION
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 SQLITE_PATH=/app/data/regiment.sqlite MIGRATIONS_DIR=/app/drizzle
RUN mkdir -p /app/data && chown node:node /app/data
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node db/sqlite.mjs db/secrets.mjs ./db/
COPY --chown=node:node scripts/start.mjs scripts/backup.mjs scripts/snapshot.mjs scripts/smoke.mjs ./scripts/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "scripts/start.mjs"]

