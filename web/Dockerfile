# CourseLab web app. Build from the repository root so the synthetic sample course is included:
#   docker build -f web/Dockerfile .
# Multi-arch: node:22-slim is published for linux/amd64 and linux/arm64; no native add-ons are compiled.
FROM node:22-slim AS build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 SAMPLE_DIR=/app/fixtures/qmb-sample UPLOAD_DIR=/data/uploads
WORKDIR /app/web
COPY --from=build --chown=node:node /app/web ./
COPY --chown=node:node fixtures/qmb-sample /app/fixtures/qmb-sample
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
EXPOSE 3000
VOLUME /data/uploads
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Apply pending migrations, then serve.
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && npx next start -p 3000"]
