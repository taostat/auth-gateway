# Resource Server -- JWT Verification

An Express server that acts as a protected API (resource server). It validates access tokens issued by the auth gateway using the gateway's JWKS endpoint. This example shows the server-side pattern for accepting and verifying tokens.

## What this demonstrates

- Fetching the gateway's public keys via `/.well-known/jwks.json` using the `jose` library
- Verifying RS256 JWTs with issuer and audience validation
- Enforcing scope-based access control on protected endpoints
- The separation between the auth gateway (token issuer) and the resource server (token consumer)

## Prerequisites

- Node.js 18+
- Auth gateway running at `http://localhost:3000` (or set `AUTH_GATEWAY_URL`)
- A valid access token obtained from one of the other examples (web-app-raw, web-app-oidc, or cli-device-code)

## Setup

1. Install dependencies:

   ```bash
   cd examples/resource-server
   npm install
   ```

2. Start the server:

   ```bash
   npm start
   ```

   Or with a required scope:

   ```bash
   REQUIRED_SCOPE=subnet:1:validator npm start
   ```

   The server listens on port 4000 by default.

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/public` | None | Returns a JSON response. Accessible without a token. |
| GET | `/protected` | Bearer token | Validates the JWT and returns the decoded claims. Returns `401` if the token is missing or invalid, `403` if the required scope is missing. |

## What to expect

1. First, obtain a token from one of the other examples (e.g., the CLI device code flow).

2. Test the public endpoint:

   ```bash
   curl http://localhost:4000/public
   ```

3. Test the protected endpoint with a valid token:

   ```bash
   curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" http://localhost:4000/protected
   ```

   On success, you receive the decoded JWT claims:

   ```json
   {
     "message": "Access granted",
     "claims": {
       "sub": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
       "scopes": ["subnet:1:validator"],
       "iss": "http://localhost:3000",
       "aud": "bittensor-apps",
       "exp": 1700000000
     }
   }
   ```

4. Test with no token or an invalid token to see the `401` response.

## Key code points

- **JWKS fetching** -- `createRemoteJWKSet` from the `jose` library fetches and caches the gateway's public keys. The keys are refreshed automatically when they rotate.
- **Issuer and audience** -- The `jwtVerify` call validates both `iss` (must match the gateway's origin) and `aud` (must be `bittensor-apps`). Tokens that fail these checks are rejected.
- **Scope enforcement** -- When `REQUIRED_SCOPE` is set, the server checks that the token's `scopes` array includes the required value. This is optional; omit the env var to skip scope checks.
- **No shared secrets** -- RS256 means the resource server only needs the gateway's public key (fetched via JWKS). There is no shared secret between the gateway and the resource server.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `AUTH_GATEWAY_URL` | `http://localhost:3000` | Base URL of the auth gateway (used to build the JWKS URL) |
| `PORT` | `4000` | Port the resource server listens on |
| `JWT_AUDIENCE` | `bittensor-apps` | Expected `aud` claim in access tokens |
| `REQUIRED_SCOPE` | (none) | If set, the `/protected` endpoint requires this scope in the token |

To verify tokens from the hosted gateway:

```bash
AUTH_GATEWAY_URL=https://auth.taostats.io npm start
```
