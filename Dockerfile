# Node 22.23.4 on Alpine 3.24 (ca-certificates-bundle 20261020-r0), pinned by
# index digest so a retag cannot change the runtime. All stages share it.
# Update the pin via: docker buildx imagetools inspect node:<tag>

# Stage 1: Install dependencies
FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Stage 2: Build (typecheck is handled by CI, not here)
FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json .esbuild.mjs ./
COPY src/ ./src/
RUN node .esbuild.mjs

# Stage 3: Production
FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS prod
WORKDIR /app
ENV NODE_ENV=production

# Fail the build if AAA Certificate Services or emSign ECC Root CA - G3 is
# trusted, by SHA-256 fingerprint, in either Node's bundled root store (what
# fetch/https/wss use) or the OS bundle (anything else in the image).
RUN node -e ' \
  const { X509Certificate } = require("node:crypto"); \
  const { rootCertificates } = require("node:tls"); \
  const { readFileSync } = require("node:fs"); \
  const removed = new Set([ \
    "D7:A7:A0:FB:5D:7E:27:31:D7:71:E9:48:4E:BC:DE:F7:1D:5F:0C:3E:0A:29:48:78:2B:C8:3E:E0:EA:69:9E:F4", \
    "86:A1:EC:BA:08:9C:4A:8D:3B:BE:27:34:C6:12:BA:34:1D:81:3E:04:3C:F9:E8:A8:62:CD:5C:57:A3:6B:BE:6B", \
  ]); \
  const bundle = readFileSync("/etc/ssl/certs/ca-certificates.crt", "utf8"); \
  const os = bundle.match(/-----BEGIN CERTIFICATE-----[^-]+-----END CERTIFICATE-----/g) ?? []; \
  if (os.length !== bundle.split("-----BEGIN CERTIFICATE-----").length - 1) { \
    throw new Error("OS bundle has a certificate block that did not parse"); \
  } \
  const stores = { node: rootCertificates, os }; \
  for (const [name, certs] of Object.entries(stores)) { \
    if (certs.length === 0) throw new Error(`${name} root store is empty`); \
    const hits = certs.map((c) => new X509Certificate(c).fingerprint256).filter((f) => removed.has(f)); \
    if (hits.length > 0) throw new Error(`${name} root store trusts removed roots: ${hits}`); \
  } \
  '

RUN addgroup -S app && adduser -S app -G app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=app:app --from=build /app/dist ./dist
COPY --chown=app:app migrations/ ./migrations/

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -q --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
