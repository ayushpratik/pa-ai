# Built with Podman on the deployment server: see README section 6.2.
#   podman build -t sales-ai:latest .
#   podman build --target migrator -t sales-ai-migrate:latest .
#
# No environment variables are needed at build time. lib/model.ts constructs the
# Gemini provider lazily so `next build` works without an API key or a database.

# Install every dependency, dev included, since the build and the migrator need them.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Applies pending Drizzle migrations. Kept as a separate target because
# drizzle-kit is a devDependency and must not reach the runtime image.
FROM node:22-alpine AS migrator
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src/db ./src/db
CMD ["npx", "drizzle-kit", "migrate"]

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
# The standalone server binds localhost by default, which inside a container
# means nothing outside it can reach the port.
ENV HOSTNAME=0.0.0.0

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3001
CMD ["node", "server.js"]
