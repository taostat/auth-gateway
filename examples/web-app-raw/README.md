# Web App -- Raw Fetch (Authorization Code + PKCE)

A minimal single-page application that implements the OAuth2 Authorization Code flow with PKCE using only the browser `fetch()` API and the Polkadot.js wallet extension. No OAuth libraries are used, making this example useful for understanding every step of the protocol.

## What this demonstrates

- Generating a PKCE `code_verifier` and `code_challenge` (S256)
- Redirecting to the gateway's `/v1/oauth/authorize` endpoint
- Handling the authorization callback with the returned `code`
- Exchanging the code for tokens via `/v1/oauth/token`
- Decoding and displaying JWT claims from the access token

## Prerequisites

- Node.js 18+
- Auth gateway running at `http://localhost:3000` (or update `AUTH_GATEWAY_URL` in `index.html`)
- A registered **public** client with:
  - `grant_types`: `["authorization_code"]`
  - `redirect_uris`: `["http://localhost:8080"]`
  - `allowed_origins`: `["http://localhost:8080"]`
- Polkadot.js browser extension installed with at least one account

## Setup

1. Register the client (if you have not already):

   ```bash
   # From the project root
   ADMIN_API_KEY=YOUR_KEY npm run setup-examples
   ```

2. Copy the printed `client_id` for "Example Web App" and paste it into `index.html`:

   ```js
   const CLIENT_ID = 'your-client-id-here';
   ```

3. Install dependencies and start the dev server:

   ```bash
   cd examples/web-app-raw
   npm install
   npm run dev
   ```

4. Open `http://localhost:8080` in your browser.

## What to expect

1. Click **Login** (or one of the scoped login buttons).
2. The app generates a PKCE challenge and redirects you to the gateway's authorize page.
3. The gateway prompts you to connect your Polkadot.js wallet and sign a challenge.
4. After signing, the gateway redirects back to `http://localhost:8080?code=...&state=...`.
5. The app exchanges the authorization code (along with the PKCE `code_verifier`) for an access token and refresh token.
6. The decoded JWT claims are displayed on screen.

## Key code points

- **PKCE generation** -- `code_verifier` is a random 32-byte value encoded as base64url. The `code_challenge` is the SHA-256 hash of the verifier, also base64url-encoded.
- **State parameter** -- A random value stored in `sessionStorage` to prevent CSRF. Verified when the callback arrives.
- **Token exchange** -- The `POST /v1/oauth/token` request includes `code_verifier` so the gateway can verify the PKCE challenge that was sent during authorization.
- **No client secret** -- Public clients authenticate using only `client_id` in the request body (no secret required). PKCE provides the security binding instead.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `AUTH_GATEWAY_URL` | `http://localhost:3000` | Base URL of the auth gateway |
| `CLIENT_ID` | (empty) | Your registered client ID |

To test against the hosted gateway, change `AUTH_GATEWAY_URL` to `https://auth.taostats.io` and register a client with the appropriate redirect URI and origin.
