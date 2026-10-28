FROM node:24-bookworm-slim
WORKDIR /app
ARG APP_REVISION
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    SQLITE_PATH=/app/data/regiment.sqlite MIGRATIONS_DIR=/app/drizzle APP_REVISION=$APP_REVISION
LABEL org.opencontainers.image.source="https://github.com/Fuhrizen/22-Elysian-Drop-Orbat" \
      org.opencontainers.image.revision=$APP_REVISION
RUN mkdir -p /app/data && chown node:node /app/data
COPY --chown=node:node .next/standalone ./
COPY --chown=node:node .next/static ./.next/static
COPY --chown=node:node public ./public
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node db/sqlite.mjs db/secrets.mjs ./db/
COPY --chown=node:node scripts/start.mjs scripts/medal-digest.mjs scripts/backup.mjs scripts/snapshot.mjs scripts/smoke.mjs ./scripts/
USER node
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=6 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/start.mjs"]

