# Auth Gateway Examples

Working examples that demonstrate how to integrate with the Taostats Auth Gateway using different OAuth2 flows.

## Prerequisites

- **Node.js 18+** (for running the example apps)
- **Auth Gateway** running locally (`http://localhost:3000`) or use the hosted instance at `https://auth.taostats.io`
- **Polkadot.js browser extension** (for web-based flows that require wallet signing)
## Quick Start

### 1. Register demo clients

Before running any example, you need registered OAuth clients. Use the setup script to create all three at once:

```bash
# From the project root
ADMIN_API_KEY=your-key npm run setup-examples

# Or with custom gateway URL
npx tsx examples/setup-demo-clients.ts --url http://localhost:3000 --key your-key
```

The script prints the `client_id` for each example. Copy these values into the corresponding example configurations.

### 2. Pick an example and run it

See the table below and follow the linked README for setup instructions.

## Examples

| Example | Flow | Description |
|---|---|---|
| [web-app-raw](./web-app-raw/) | Authorization Code + PKCE | Minimal single-page app using raw `fetch()` calls against the gateway. No libraries. Good for understanding the protocol step by step. |
| [web-app-oidc](./web-app-oidc/) | Authorization Code + PKCE | Single-page app using [`oidc-client-ts`](https://github.com/authts/oidc-client-ts) to handle discovery, PKCE, and token management automatically. Recommended starting point for web apps. |
| [cli-device-code](./cli-device-code/) | Device Authorization (RFC 8628) | Terminal-based CLI that requests a device code, opens the browser for user approval, and polls for tokens. Ideal for headless tools, bots, and scripts. |
| [resource-server](./resource-server/) | JWT verification | Express server that validates access tokens using the gateway's JWKS endpoint. Shows how a backend API accepts and verifies tokens issued by the gateway. |

## Architecture Overview

```
Browser / CLI
    |
    |  OAuth2 flow (authorize, device code, etc.)
    v
Auth Gateway  (issues JWTs signed with RS256)
    |
    |  JWKS endpoint (/.well-known/jwks.json)
    v
Resource Server  (verifies JWTs using the public key)
```

All access tokens are standard RS256 JWTs. Any service can verify them independently by fetching the gateway's JWKS document -- no shared secrets required.

## Hosted Gateway

The hosted gateway is available at:

```
https://auth.taostats.io
```

Replace `http://localhost:3000` in any example configuration to test against the hosted instance. Note that redirect URIs and allowed origins must be registered for your client to match the URL your app is served from.
