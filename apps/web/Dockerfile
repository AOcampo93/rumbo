# syntax=docker/dockerfile:1
# Build context: repository root (Coolify base directory "/").
FROM node:24-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo
# Download every locked package once; this layer is reused until the lockfile changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --offline --frozen-lockfile --filter @rumbo/web...
RUN pnpm --filter @rumbo/web build

# Static files only: no Node.js in the runtime image.
FROM nginx:1.30-alpine AS runtime
# Coolify injects the real SOURCE_COMMIT at runtime; "unknown" keeps the
# template valid anywhere else (e.g. a local `docker run`).
ENV SOURCE_COMMIT=unknown NGINX_ENVSUBST_FILTER=^SOURCE_COMMIT$
COPY apps/web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
