# CLI -- Device Authorization Flow (RFC 8628)

A terminal-based CLI application that authenticates using the OAuth2 Device Authorization Grant (RFC 8628). The CLI requests a device code, displays a user code, opens the browser for wallet-based approval, and polls for tokens.

## What this demonstrates

- Requesting a device code from `POST /v1/device/code`
- Displaying a user code and verification URI to the user
- Polling `POST /v1/device/token` with backoff (handling `authorization_pending` and `slow_down`)
- Receiving access and refresh tokens after browser-side approval
- Decoding and displaying JWT claims

## Prerequisites

- Node.js 18+
- Auth gateway running at `http://localhost:3000` (or set `AUTH_GATEWAY_URL`)
- A registered **public** client with:
  - `grant_types`: `["urn:ietf:params:oauth:grant-type:device_code"]`
- Polkadot.js browser extension installed with at least one account (for approving in the browser)

## Setup

1. Register the client (if you have not already):

   ```bash
   # From the project root
   ADMIN_API_KEY=YOUR_KEY npm run setup-examples
   ```

2. Install dependencies:

   ```bash
   cd examples/cli-device-code
   npm install
   ```

3. Run the CLI with your client ID:

   ```bash
   npx tsx device-auth.ts YOUR_CLIENT_ID
   ```

   Or with scopes:

   ```bash
   npx tsx device-auth.ts YOUR_CLIENT_ID subnet:1:validator
   ```

   You can also use environment variables:

   ```bash
   AUTH_GATEWAY_URL=https://auth.taostats.io CLIENT_ID=your-id npm start
   ```

## What to expect

1. The CLI prints a **user code** (e.g., `ABCD-1234`) and a **verification URL**.
2. Your browser opens to the gateway's device verification page with the code pre-filled.
3. On the verification page, connect your Polkadot.js wallet and sign the challenge to approve.
4. Back in the terminal, the CLI detects the approval and prints the access token details:
   - Wallet address (`sub` claim)
   - Granted scopes
   - Token expiry time
   - The raw access and refresh tokens

## Key code points

- **Polling loop** -- The CLI polls `POST /v1/device/token` at the interval specified by the gateway. A `428` status means "slow down" (the client is polling too fast). A `200` means the user approved and tokens are ready.
- **Error handling** -- If the user denies authorization, the gateway returns `403`. If the device code expires before approval, it returns `401`.
- **No browser dependency** -- The CLI itself has no browser dependency. It opens the system browser for the user to approve, but the token exchange happens entirely via HTTP from the terminal.
- **Grant type URN** -- The device code grant uses the standard URN `urn:ietf:params:oauth:grant-type:device_code` as the `grant_type` value.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `AUTH_GATEWAY_URL` | `http://localhost:3000` | Base URL of the auth gateway |
| `CLIENT_ID` | (none) | Your registered client ID (or pass as first CLI argument) |
| `SCOPES` | (none) | Space-separated scopes (or pass as CLI arguments after client ID) |

To test against the hosted gateway:

```bash
AUTH_GATEWAY_URL=https://auth.taostats.io npx tsx device-auth.ts YOUR_CLIENT_ID
```
