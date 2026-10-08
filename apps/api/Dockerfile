# syntax=docker/dockerfile:1
# Build context: repository root (Coolify base directory "/").
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

# Download every locked package once; this layer is reused until the lockfile changes.
FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch

FROM fetch AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --offline --frozen-lockfile --filter @rumbo/api...
RUN pnpm --filter @rumbo/api build

# Starts from `base`, not `fetch`: `pnpm fetch` fills node_modules/.pnpm with the
# whole lockfile (Vue, Vite, Vitest…), and none of that belongs in the API image.
FROM base AS prod-deps
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --prod --filter @rumbo/api...

FROM node:24-alpine AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /repo
# Keep pnpm's layout: apps/api/node_modules holds symlinks into node_modules/.pnpm.
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/apps/api/node_modules ./apps/api/node_modules
# The bundle (workspace packages compiled in), its SQL migrations, and the
# curated routes it seeds on start.
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/drizzle ./apps/api/drizzle
COPY data/routes ./data/routes
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/server.js"]
