# SiteSurge server image — API + SSR + bundled admin/public SPA.
# Multi-stage: build the whole workspace, then run the built server on `node`.
# Build context is the repo root (see config/docker-compose.yml).
#
#   docker build -f config/Dockerfile -t sitesurge/server .
#   docker run --env-file packages/api/.env -p 3001:3001 sitesurge/server
#
# Debian slim (glibc) rather than alpine so sharp's prebuilt binaries load.

# ---- builder ----------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
ENV CI=true
RUN corepack enable
WORKDIR /app

# Copy everything (the .dockerignore prunes node_modules/dist/.env/etc) and let
# pnpm resolve the workspace. Simpler + more robust than staged manifest copies
# for a monorepo; the layer cache still helps when only source changes.
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm run build

# (Dev deps are left in place — pnpm's `prune` mangles the workspace symlinks the
# server resolves at runtime. Trimming the image is a follow-up; correctness first.)

# ---- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Built workspace: dist for every package (incl. packages/cms/dist, the admin/
# public SPA the server serves) + pruned node_modules + workspace symlinks.
COPY --from=builder /app /app

# The server resolves the SPA from ../cms/dist and reads .env from its own cwd.
WORKDIR /app/packages/api

# Uploads + data are runtime state — mount volumes for these (see compose).
EXPOSE 3001
CMD ["node", "dist/index.js"]
