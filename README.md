<p align="center">
  <img src="src/static/logo-dark-bg.svg" alt="Taostats" width="400">
</p>

<h1 align="center">Auth Gateway</h1>

<p align="center">
  <a href="https://github.com/taostat/auth-gateway/actions/workflows/ci.yml"><img src="https://github.com/taostat/auth-gateway/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg" alt="Node.js"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-strict-blue.svg" alt="TypeScript"></a>
</p>

<p align="center">
  OAuth 2.0-compliant authentication gateway for the Bittensor ecosystem.<br>
  Authenticates wallets via Substrate sr25519 challenge-response, issues RS256 JWTs, and verifies on-chain roles (miner, validator, subnet owner, TAO holder) against live Subtensor state — so any app or service can gate access based on what a wallet actually does on the network.
</p>

## Key Features

- **Three auth flows**: Challenge-response (simple), OAuth2 authorization code (web apps), Device code / RFC 8628 (CLIs)
- **On-chain scope verification**: Validates miner, validator, owner, and holder roles against Subtensor state
- **Epoch-aligned re-verification**: Skips redundant on-chain calls within the same epoch
- **PKCE support**: Required for public clients (S256 only)
- **Refresh token rotation**: DB-backed with revocation support
- **Client registration**: Admin API for managing OAuth clients

## Architecture

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│  Client App  │──────▶│ Auth Gateway │──────▶│  Subtensor   │
│  (browser /  │ HTTP  │  (Fastify)   │  WS   │  (Finney)    │
│   CLI)       │       │              │       │              │
└──────────────┘       └──────┬───────┘       └──────────────┘
                              │
                       ┌──────▼───────┐
                       │  PostgreSQL  │
                       │  (clients,   │
                       │  tokens)     │
                       └──────────────┘
```

- **Fastify** HTTP server with RS256 JWT signing
- **PostgreSQL** for client registration and refresh token storage
- **Subtensor** WebSocket connection for on-chain state queries
- **PostgreSQL** for challenges, device codes, and consumed auth codes (DB-backed, multi-instance safe)

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- Docker & Docker Compose (optional)

### Setup

```bash
# Clone and install
git clone <repo-url> && cd auth-gateway
npm install

# Generate RSA keys
npm run generate-keys

# Configure environment
cp .env.dist .env
# Edit .env with your database URL, admin key, etc.

# Start PostgreSQL (via Docker Compose)
docker compose up -d postgres

# Run in development mode (auto-runs migrations)
npm run dev

# Or build and start production
npm run build
npm start
```

### Demo Mode

The fastest way to try the gateway — auto-creates demo clients and serves an interactive landing page:

```bash
# Using Docker Compose (recommended)
npm run demo

# Or manually (requires PostgreSQL + Subtensor)
DEMO_MODE=true npm run dev
```

Visit `http://localhost:3000` to see the landing page with "Try it" buttons for the OAuth2 flow. The landing page handles the full PKCE flow inline — no separate client app needed.

See [`examples/`](./examples/) for standalone integration examples.

### Create a Client

```bash
# Via the admin API
curl -X POST http://localhost:3000/v1/admin/clients \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: your-admin-key" \
  -d '{
    "client_name": "My App",
    "client_type": "public",
    "redirect_uris": ["http://localhost:3001/callback"],
    "grant_types": ["authorization_code"],
    "allowed_origins": ["http://localhost:3001"]
  }'

# Or via the CLI script
npx tsx scripts/create-client.ts
```

## API Reference

### Authentication (Challenge-Response)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/auth/challenge` | POST | Request a signing challenge for an address |
| `/v1/auth/verify` | POST | Verify signature and receive tokens |

### OAuth2 (Authorization Code)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/oauth/authorize` | GET | Authorization page (browser redirect) |
| `/v1/oauth/callback` | POST | Internal: exchange signed challenge for auth code |
| `/v1/oauth/token` | POST | Exchange auth code for access + refresh tokens |
| `/v1/oauth/refresh` | POST | Refresh token rotation |

### Device Code (RFC 8628)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/device/code` | POST | Request a device code + user code |
| `/v1/device/token` | POST | Poll for token (CLI polling) |
| `/v1/device/verify` | GET | User-facing verification page |
| `/v1/device/approve` | POST | Initiate approval (creates challenge) |
| `/v1/device/confirm` | POST | Confirm approval with signature |
| `/v1/device/scopes` | GET | Look up scopes for a user code |

### Admin

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/admin/clients` | POST | Register a new OAuth client |
| `/v1/admin/clients` | GET | List all registered clients |
| `/v1/admin/clients/:id` | DELETE | Deactivate a client |

### Discovery & Health

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/openid-configuration` | GET | OIDC discovery document |
| `/.well-known/jwks.json` | GET | JSON Web Key Set |
| `/health` | GET | Health check (subtensor + database) |

## Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | Server port | `3000` | No |
| `HOST` | Bind address | `0.0.0.0` | No |
| `NODE_ENV` | Environment | `development` | No |
| `NETWORK` | Network mode (`mainnet` or `testnet`) | `mainnet` | No |
| `RSA_PRIVATE_KEY_PATH` | Path to RSA private key | — | Yes* |
| `RSA_PUBLIC_KEY_PATH` | Path to RSA public key | — | Yes* |
| `RSA_PRIVATE_KEY_BASE64` | Base64-encoded private key | — | Yes* |
| `RSA_PUBLIC_KEY_BASE64` | Base64-encoded public key | — | Yes* |
| `JWT_ISSUER` | JWT issuer claim | `auth.taostats.io` | No |
| `JWT_AUDIENCE` | JWT audience claim | `bittensor-apps` | No |
| `JWT_ACCESS_TOKEN_EXPIRY` | Access token TTL fallback (seconds) | `900` | No |
| `JWT_REFRESH_TOKEN_EXPIRY` | Refresh token TTL (seconds) | `86400` | No |
| `JWT_AUTH_CODE_EXPIRY` | Auth code TTL (seconds) | `30` | No |
| `SUBTENSOR_WS_URL` | Subtensor WebSocket URL | `wss://entrypoint-finney.opentensor.ai:443` | No |
| `SUBTENSOR_BLOCK_TIME` | Block time in seconds | `12` | No |
| `TAOSTATS_API_URL` | Taostats API URL (holder scope fallback) | `https://api.taostats.io` | No |
| `CHALLENGE_TTL_SECONDS` | Challenge TTL | `120` | No |
| `DEVICE_CODE_TTL_SECONDS` | Device code TTL | `300` | No |
| `DEVICE_CODE_POLL_INTERVAL` | Minimum poll interval (seconds) | `5` | No |
| `VERIFICATION_URI` | Device verification URL | `http://localhost:3000/v1/device/verify` | No |
| `RATE_LIMIT_GLOBAL` | Global rate limit (req/min) | `10` | No |
| `RATE_LIMIT_CHALLENGE` | Challenge endpoint rate limit | `5` | No |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://localhost:5432/auth_gateway` | Yes |
| `ADMIN_API_KEY` | Admin API authentication key | — | Yes (prod) |
| `RUN_MIGRATIONS` | Auto-run migrations on startup | `true` | No |
| `PUBLIC_URL` | Public-facing URL for discovery | `http://localhost:3000` | No |
| `DEMO_MODE` | Enable demo mode (auto-creates clients, interactive landing page) | `false` | No |

\* Provide either file paths or base64-encoded keys.

## Scopes

Scopes follow the format `subnet:{netuid}:{role}`.

### Supported Roles

| Role | Description | On-chain Verification |
|------|-------------|-----------------------|
| `miner` | Registered miner on the subnet | Hotkey in `keys` + zero `dividends` |
| `validator` | Validator on the subnet | Hotkey in `keys` + non-zero `dividends` |
| `owner` | Subnet owner | `subnetOwner` storage |
| `holder` | Alpha token holder | `alpha` balance > 0 |

### Examples

```
subnet:1:miner       # Miner on subnet 1
subnet:1:validator   # Validator on subnet 1
subnet:18:owner      # Owner of subnet 18
subnet:1:holder      # Holds alpha tokens on subnet 1
```

Scopes are verified on-chain during initial authentication and **always re-verified on refresh**. Access tokens are epoch-aligned — they expire at the next epoch boundary, so refresh frequency is naturally governed by the subnet's tempo.

## Security

- **PKCE (S256)**: Required for public clients, prevents authorization code interception
- **Timing-safe comparisons**: Used for PKCE verification, admin API key checks, and other secret comparisons
- **Auth code single-use**: JWT-based auth codes are tracked and rejected on replay
- **DB-backed stores**: Challenges, device codes, and consumed auth codes stored in PostgreSQL (multi-instance safe)
- **Refresh token rotation**: Old token revoked after new one is stored (safe ordering)
- **Admin API key**: Required in production (`ADMIN_API_KEY` must be set)
- **Redirect URI validation**: Whitelisted against registered URIs, HTTPS required in production, fragments rejected
- **Non-root Docker**: Production container runs as non-root user
- **Rate limiting**: Per-IP and per-client rate limiting on all endpoints
- **Epoch-aligned access tokens**: Access tokens expire at the next epoch boundary, naturally gating scope re-verification frequency
- **Subtensor query timeouts**: All on-chain queries have 10-second timeouts

## Development

### Project Structure

```
src/
├── config.ts                  # Environment configuration
├── index.ts                   # Server entrypoint
├── demo.ts                    # Demo client bootstrap
├── types.ts                   # TypeScript interfaces
├── styles.ts                  # Shared CSS
├── crypto/
│   ├── jwt.ts                 # JWT creation and verification
│   ├── keys.ts                # RSA key loading
│   ├── pkce.ts                # PKCE S256 challenge/verification
│   ├── challenge.ts           # Challenge store (DB-backed)
│   ├── authCodeTracker.ts     # Auth code single-use tracking
│   └── signature.ts           # sr25519 signature verification
├── db/
│   ├── pool.ts                # PostgreSQL connection pool
│   ├── migrate.ts             # Migration runner
│   ├── clients.ts             # Client CRUD (with 60s cache)
│   ├── refreshTokens.ts       # Refresh token CRUD
│   ├── challenges.ts          # Challenge storage
│   ├── deviceCodes.ts         # Device code storage
│   └── consumedAuthCodes.ts   # Auth code replay prevention
├── middleware/
│   ├── clientAuth.ts          # Client authentication extraction
│   └── clientRateLimit.ts     # Per-client rate limiting
├── routes/
│   ├── index.ts               # Route registration
│   ├── auth.ts                # Challenge-response flow
│   ├── oauth/
│   │   ├── index.ts           # OAuth route registration
│   │   ├── authorize.ts       # Authorization page + callback
│   │   ├── token.ts           # Token exchange + refresh
│   │   └── shared.ts          # Shared utilities (epoch, HTML)
│   ├── device.ts              # Device code flow (RFC 8628)
│   ├── admin.ts               # Client management API
│   ├── discovery.ts           # OIDC discovery document
│   ├── jwks.ts                # JWKS endpoint
│   ├── health.ts              # Health check
│   └── landing.ts             # Landing page (/ route)
├── scopes/
│   ├── index.ts               # Scope parsing, validation, verification
│   ├── miner.ts               # Miner role (zero dividends)
│   ├── validator.ts           # Validator role (non-zero dividends)
│   ├── owner.ts               # Subnet owner role
│   ├── holder.ts              # Alpha token holder role
│   ├── types.ts               # Scope handler interface
│   └── signerContext.ts       # Signer context (hotkey/coldkey)
├── subtensor/
│   ├── client.ts              # Subtensor WebSocket client
│   └── queries.ts             # On-chain queries (with timeouts)
├── util/
│   ├── errors.ts              # Custom error classes
│   ├── boundedMap.ts          # Bounded map with eviction
│   ├── html.ts                # HTML escaping utilities
│   └── testnet.ts             # Testnet banner helper
└── test/                      # Jest test suite
```

### Running Tests

```bash
npm test                    # Run all tests
npx jest --no-cache         # Run without cache
npm run typecheck           # TypeScript type checking
```

### Adding a New Scope Type

1. Add the role to the scope verifier in `src/scopes/index.ts`
2. Implement the on-chain query in `src/subtensor/queries.ts`
3. Add a description for the role in `describeScopes()`
4. Add tests

## Deployment

### Docker

```bash
docker compose up -d                  # Start all services
docker compose up -d --build          # Rebuild and start
```

The Dockerfile uses multi-stage builds, runs as non-root, and includes a health check.

### Migrations

Migrations run automatically on startup when `RUN_MIGRATIONS=true` (default). They can also be run manually:

```bash
npm run migrate
```

Migration files are in `migrations/` and tracked in the `_migrations` table.

### Production Checklist

- Set `NODE_ENV=production`
- Set a strong `ADMIN_API_KEY`
- Use HTTPS via a reverse proxy (nginx, Caddy, etc.)
- Provide RSA keys via `RSA_PRIVATE_KEY_BASE64` / `RSA_PUBLIC_KEY_BASE64`
- Configure `PUBLIC_URL` to your external URL
- Set `VERIFICATION_URI` to your public device verification URL
- Monitor `/health` endpoint (checks both subtensor and database connectivity)

## For Developers: Integrating with Auth Gateway

The gateway is a standard OAuth2/OIDC provider. Any OAuth2 client library will work.

### Quick Integration

1. **Register a client** via the admin API or `npm run setup-examples`
2. **Discover endpoints** via `/.well-known/openid-configuration`
3. **Validate tokens** in your resource server using the JWKS at `/.well-known/jwks.json`

### Examples

See the [`examples/`](./examples/) directory for complete, runnable integration examples:

| Example | Flow | Description |
|---------|------|-------------|
| [`web-app-raw`](./examples/web-app-raw/) | Authorization Code + PKCE | Single HTML file, zero dependencies |
| [`web-app-oidc`](./examples/web-app-oidc/) | Authorization Code + PKCE | Uses `oidc-client-ts` library |
| [`cli-device-code`](./examples/cli-device-code/) | Device Code (RFC 8628) | Standalone Node.js CLI script |
| [`resource-server`](./examples/resource-server/) | Token Validation | Express + jose JWKS verification |

### Token Structure

Access tokens are RS256 JWTs with these claims:

```json
{
  "sub": "5GrwvaEF...",        // SS58 wallet address
  "scopes": ["subnet:1:validator"],
  "type": "access",
  "jti": "uuid-v4",
  "hotkey": "5FHneW46...",     // hotkey address (null if signer is coldkey)
  "coldkey": "5GrwvaEF...",    // coldkey address (always present)
  "client_id": "...",          // present in OAuth flows
  "scope": "subnet:1:validator",
  "iss": "auth.taostats.io",
  "aud": "bittensor-apps",
  "exp": 1234567890,
  "iat": 1234567800
}
```

The `hotkey` and `coldkey` claims are resolved from the Subtensor chain at authentication time. If the signer is a registered hotkey, `hotkey` is set to the signing address and `coldkey` to its owner. If the signer is a coldkey (or unregistered address), `hotkey` is `null` and `coldkey` is the signing address. These are point-in-time snapshots — a hotkey could deregister between token issuance and use.

## License

This project is licensed under the [Apache License 2.0](./LICENSE).

The "Taostats" name and logo are trademarks. See [TRADEMARK.md](./TRADEMARK.md) for branding guidelines.

For security issues, see [SECURITY.md](./SECURITY.md).
