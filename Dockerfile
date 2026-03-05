# Stage 1: Install dependencies
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Stage 2: Build (typecheck is handled by CI, not here)
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json .esbuild.mjs ./
COPY src/ ./src/
RUN node .esbuild.mjs

# Stage 3: Production
FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S app && adduser -S app -G app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=app:app --from=build /app/dist ./dist
COPY --chown=app:app migrations/ ./migrations/

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -q --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
