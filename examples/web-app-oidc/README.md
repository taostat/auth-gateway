# Web App -- OIDC Client (Authorization Code + PKCE)

A single-page application that uses the [`oidc-client-ts`](https://github.com/authts/oidc-client-ts) library to implement the OAuth2 Authorization Code flow with PKCE. The library handles OIDC discovery, PKCE generation, token exchange, and session management automatically.

## What this demonstrates

- Using `oidc-client-ts` with the gateway's OpenID Connect discovery document
- Automatic PKCE (S256) handling by the library
- Redirect-based login with the Polkadot.js wallet extension
- Decoding and displaying JWT claims from the access token
- Client-side session management (login / logout)

## Prerequisites

- Node.js 18+
- Auth gateway running at `http://localhost:3000` (or update `AUTH_GATEWAY_URL` in `index.html`)
- A registered **public** client with:
  - `grant_types`: `["authorization_code"]`
  - `redirect_uris`: `["http://localhost:5173"]`
  - `allowed_origins`: `["http://localhost:5173"]`
- Polkadot.js browser extension installed with at least one account

## Setup

1. Register the client (if you have not already):

   ```bash
   # From the project root
   ADMIN_API_KEY=YOUR_KEY npm run setup-examples
   ```

2. Copy the printed `client_id` for "Example OIDC Web App" and paste it into `index.html`:

   ```js
   const settings = {
     authority: AUTH_GATEWAY_URL,
     client_id: 'your-client-id-here',  // <-- set this
     ...
   };
   ```

3. Install dependencies and start the dev server:

   ```bash
   cd examples/web-app-oidc
   npm install
   npm run dev
   ```

4. Open `http://localhost:5173` in your browser.

## What to expect

1. Click **Login** to start a basic authentication flow, or use **Login as Validator** / **Login as Holder** to request specific scopes.
2. `oidc-client-ts` automatically fetches the gateway's `/.well-known/openid-configuration`, generates a PKCE challenge, and redirects to the authorize endpoint.
3. The gateway prompts you to connect your Polkadot.js wallet and sign a challenge.
4. After signing, the gateway redirects back to `http://localhost:5173?code=...&state=...`.
5. The library exchanges the code for tokens and displays the decoded JWT claims.

## Key code points

- **OIDC discovery** -- The library fetches `/.well-known/openid-configuration` to discover the `authorization_endpoint`, `token_endpoint`, and `jwks_uri`. This means you only configure the `authority` URL.
- **Automatic PKCE** -- `oidc-client-ts` generates the `code_verifier` / `code_challenge` pair and includes them in the authorization and token requests automatically.
- **UserManager** -- The `oidc.UserManager` class manages the full lifecycle: redirect, callback processing, token storage, and session state.
- **Scoped login** -- The `loginAsValidator()` and `loginAsHolder()` functions pass an extra `scope` parameter to `signinRedirect()`. The gateway verifies on-chain that the wallet holds the required role.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `AUTH_GATEWAY_URL` | `http://localhost:3000` | Base URL of the auth gateway (used as the OIDC `authority`) |
| `client_id` | (empty) | Your registered client ID |
| `redirect_uri` | `http://localhost:5173` | Must match the registered redirect URI |

To test against the hosted gateway, change `AUTH_GATEWAY_URL` to `https://auth.taostats.io` and register a client with the appropriate redirect URI and origin.
