# Budget Buddy: one image for the API, the built web app and the jobs (DEP-1).
# Build for the Mac mini with: docker build --platform linux/arm64 -t budget-buddy .
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# Only the package manifests, so the install layers are cached until a
# dependency changes.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/prepare.mjs scripts/prepare.mjs
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY web/package.json web/package.json

# Everything is installed and built here; none of it reaches the final image.
FROM manifests AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY web web
RUN pnpm --filter @budget-buddy/shared build \
 && pnpm --filter @budget-buddy/web build \
 && pnpm --filter @budget-buddy/server build

# The server's production dependencies only: dev dependencies are left out.
FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter "@budget-buddy/server..."

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    BACKUP_DIR=/backups
WORKDIR /app
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/shared/package.json ./shared/package.json
COPY --from=prod-deps /app/shared/node_modules ./shared/node_modules
COPY --from=prod-deps /app/server/package.json ./server/package.json
COPY --from=prod-deps /app/server/node_modules ./server/node_modules
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/drizzle ./server/drizzle
COPY --from=build /app/web/dist ./web/dist
# The state lives in two mounted folders (DEP-2); the image owns empty ones so
# a fresh volume starts writable by the app's user.
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server/dist/index.js"]
