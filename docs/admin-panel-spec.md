# OAuth Client Admin Panel — Front End Spec

## Overview

The Taostats profile section will include an "OAuth Applications" (or "Developer Apps") panel where authenticated users can create and manage OAuth clients for the auth gateway. This allows developers to set up authentication for their own applications using Taostats identity (Substrate wallets and EVM wallets).

**Architecture**: Front end <-> Management API <-> Auth Gateway Admin API. The management API holds the admin API key and enforces per-user ownership. The front end never speaks to the auth gateway directly for admin operations.

---

## Data Model

Each OAuth client has the following fields:

| Field | Type | User-editable | Notes |
|---|---|---|---|
| `client_id` | string (UUID) | No | Generated at creation, displayed as read-only |
| `client_secret` | string | No | Shown once at creation and on rotation (confidential clients only) |
| `client_name` | string | Yes | Human-readable label |
| `client_type` | `confidential` or `public` | No (set at creation) | Cannot be changed after creation |
| `redirect_uris` | string[] | Yes | At least one required for authorization_code grant |
| `grant_types` | enum[] | Yes | `authorization_code`, `refresh_token`, `urn:ietf:params:oauth:grant-type:device_code` |
| `allowed_scopes` | string[] | Yes | Built via scope builder (see below) |
| `allowed_origins` | string[] | Yes | CORS origins for browser-based flows |
| `allowed_sign_methods` | `sr25519` or `evm` | No (set at creation) | Exactly one; determines available scopes |
| `rate_limit` | number | No | Controlled by management API / user tier |
| `active` | boolean | No (admin action) | Deactivate only |
| `created_at` | timestamp | No | Display as read-only |

---

## Views

### 1. Client List View

The default view when a user navigates to their OAuth applications.

**Layout**: A table or card grid showing all clients owned by the user.

Each entry shows:
- Client name
- Client ID (truncated, with copy button)
- Client type badge (`Confidential` / `Public`)
- Sign method badge (`Polkadot` / `Ethereum`)
- Status badge (`Active` / `Inactive`)
- Created date
- Actions: **Edit** (opens detail view), **Deactivate** (with confirmation)

**Empty state**: When a user has no clients, show a clear call-to-action:
> "You haven't created any applications yet. Create one to let users authenticate with their Bittensor wallet."
>
> [Create Application]

---

### 2. Create Client Flow

Modeled after Google Cloud Console's OAuth credential creation. The user picks an application type first, which pre-fills sensible defaults, then configures details.

#### Step 1: Choose Application Type

Present as selectable cards (not a dropdown). Each card has a title, short description, and icon.

| Card | Sets | Description |
|---|---|---|
| **Web Application** | `confidential`, `authorization_code` + `refresh_token`, `sr25519` | Server-side app with a backend that can keep a secret. Users authenticate with a Polkadot wallet. |
| **Single Page App** | `public`, `authorization_code` + `refresh_token`, `sr25519` | Browser-only app (React, Vue, etc.) with no backend. Uses PKCE. Users authenticate with a Polkadot wallet. |
| **Device / CLI** | `public`, `device_code`, `sr25519` | Headless apps, CLIs, or smart TVs. Users approve on a separate device. |
| **EVM Web Application** | `confidential`, `authorization_code` + `refresh_token`, `evm` | Server-side app. Users authenticate with an Ethereum wallet (MetaMask, etc.). Identity only (openid). |
| **EVM Single Page App** | `public`, `authorization_code` + `refresh_token`, `evm` | Browser-only EVM app. Uses PKCE. Identity only (openid). |

Selecting a card pre-fills `client_type`, `grant_types`, and `allowed_sign_methods`. The user can still adjust grant types in Step 2 (e.g., add `device_code` to a web app), but `client_type` and `allowed_sign_methods` are locked after this choice.

#### Step 2: Configure Client

A single form page with the following sections:

**Basic Info**
- **Application Name** (required, text input, max 100 chars)

**Redirect URIs** (required for `authorization_code` grant; hidden for device-code-only clients)
- Multi-value input: text field + "Add" button, listed below with remove buttons
- Validation: must be a valid URL, no fragments (`#`), HTTPS required in production (localhost exempt)
- Helper text: *"The URI where users are redirected after authorization. For development, `http://localhost:PORT/callback` is allowed."*

**Allowed Origins** (shown for public clients / SPA types)
- Multi-value input, same pattern as redirect URIs
- Helper text: *"Origins allowed to make browser requests to the auth gateway (CORS). Example: `https://myapp.example.com`"*

**Grant Types** (pre-filled from Step 1, editable)
- Checkbox group:
  - `Authorization Code` — standard browser redirect flow
  - `Refresh Token` — allow token renewal without re-authentication
  - `Device Code` — for headless/CLI apps, users approve on a separate device
- Validation: at least one required. If `authorization_code` is selected, at least one redirect URI is required.

**Scopes** (see Scope Builder section below)

#### Step 3: Review & Create

Summary of all configured values. Confirm button: **"Create Application"**.

On success, show a **one-time secret dialog** (confidential clients only):

> **Your client secret**
>
> Copy this secret now. It will not be shown again.
>
> `a1b2c3d4e5f6...` [Copy]
>
> **Client ID**: `uuid-here` [Copy]
>
> [Done]

For public clients, skip the secret dialog and show client ID with a copy button.

---

### 3. Client Detail / Edit View

Accessed by clicking a client in the list. Split into sections matching the create form.

**Header**: Client name, client ID (with copy), status badge, type badge, sign method badge.

**Read-only fields displayed at top**:
- Client ID
- Client Type
- Sign Method
- Rate Limit (show as "X requests/minute", note that this is determined by account tier)
- Created

**Editable sections** (each with inline Save / Cancel, or a single Save button at the bottom):
- Application Name
- Redirect URIs (add/remove)
- Allowed Origins (add/remove)
- Grant Types (checkboxes)
- Allowed Scopes (scope builder)

**Secret Management** (confidential clients only, visually distinct section):
- **Rotate Client Secret**: Button that opens a confirmation dialog: *"This will generate a new secret and immediately invalidate the old one. Any application using the current secret will stop working."* -> [Rotate Secret]
- On success, display the new secret in the same one-time dialog as creation (copy button, monospace, cannot be retrieved later).

**Danger Zone** (bottom of page, visually distinct — red border or similar):
- **Deactivate Application**: Confirmation dialog: *"This will immediately revoke all tokens and prevent new authentications. This cannot be undone."* -> [Deactivate]

---

## Scope Builder

Scopes define what on-chain properties a user must have to authenticate. **All configured scopes must be satisfied** (AND logic). The UI must make this clear.

### Layout

A callout/banner at the top of the scope section:

> **How scopes work**: Each scope is a requirement the user must meet. When multiple scopes are configured, the user must satisfy **all of them** to authenticate. Leave scopes empty to allow any wallet to authenticate (identity only).

Below the callout, a list of configured scopes (removable chips/tags with human-readable labels), and an "Add Scope" button that opens the scope builder.

### EVM Clients

For EVM clients (`allowed_sign_methods: ['evm']`), the scope section is simplified:

> EVM clients support identity verification only. The `openid` scope is automatically included.

No scope builder is shown. `allowed_scopes` is set to `['openid']` automatically.

### Scope Builder Modal / Inline Form

When the user clicks "Add Scope", present a two-level selector:

**Level 1: Scope Category** (radio or segmented control)

| Category | Description |
|---|---|
| Subnet Role | Require the user to be a miner, validator, or subnet owner |
| Subnet Token Holder | Require the user to hold alpha tokens on a subnet |
| TAO Holder | Require the user to hold a minimum TAO balance |
| Delegator | Require the user to be delegating to a specific validator |
| Staker | Require total staked TAO across all subnets |

**Level 2: Parameters** (changes based on category)

**Subnet Role**:
- Subnet ID (number input, required)
- Role (dropdown: Miner, Validator, Owner)
- Produces: `subnet:{netuid}:{role}` (e.g., `subnet:1:miner`)

**Subnet Token Holder**:
- Subnet ID (number input, required)
- Minimum Alpha Balance (number input, optional — "Leave empty to require any amount")
- Produces: `subnet:{netuid}:holder` or `subnet:{netuid}:holder:{amount}`

**TAO Holder**:
- Minimum TAO Balance (number input, optional)
- Produces: `tao:holder` or `tao:holder:{amount}`

**Delegator**:
- Validator Hotkey (SS58 address input, required, validated as 48-char SS58)
- Minimum Delegated TAO (number input, optional)
- Produces: `delegate:{hotkey}` or `delegate:{hotkey}:{amount}`

**Staker**:
- Minimum Total Staked TAO (number input, required)
- Produces: `staker:{amount}`

Each scope addition shows a **preview** of the raw scope string and a human-readable description before confirming. Example:

> **Scope**: `subnet:1:validator`
> **Requires**: User is a Validator on Subnet 1
>
> [Add Scope] [Cancel]

### Scope Display

Configured scopes are shown as a list of readable cards/chips:

```
[x] Validator on Subnet 1          subnet:1:validator
[x] TAO Holder (min 100 TAO)       tao:holder:100
```

Each has a remove button. The raw scope string is shown in a muted/secondary style for developer reference.

---

## Validation Rules

The front end should validate client-side for fast feedback. The management API and auth gateway also validate server-side.

| Rule | When |
|---|---|
| Client name is required and non-empty | Create, Edit |
| At least one redirect URI if `authorization_code` grant is selected | Create, Edit |
| Redirect URIs must be valid URLs without fragments | Create, Edit |
| Redirect URIs must use HTTPS (except localhost) | Production only |
| Allowed origins must be valid origins (scheme + host, no path) | Create, Edit |
| At least one grant type selected | Create, Edit |
| EVM clients: scopes must be `['openid']` only | Create, Edit |
| Scope format matches expected patterns | Create, Edit |
| Subnet ID is a non-negative integer | Scope builder |
| Amounts are non-negative numbers | Scope builder |
| Validator hotkey is a valid SS58 address (starts with `5`, 48 chars) | Scope builder |
| Staker scope requires an amount (no base form) | Scope builder |

---

## Management API Endpoints

The management API mediates between the front end and the auth gateway admin API. It enforces ownership and tier-based restrictions (like rate limits). The front end calls these endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/oauth-clients` | List the current user's clients |
| `POST` | `/api/oauth-clients` | Create a new client (management API injects `rate_limit` based on tier, then calls auth gateway) |
| `GET` | `/api/oauth-clients/:client_id` | Get a single client's details |
| `PATCH` | `/api/oauth-clients/:client_id` | Update mutable fields (name, redirect_uris, allowed_origins, grant_types, allowed_scopes) |
| `POST` | `/api/oauth-clients/:client_id/rotate-secret` | Rotate the client secret (confidential only), returns new secret |
| `DELETE` | `/api/oauth-clients/:client_id` | Deactivate a client |

**Note**: The auth gateway now supports Create (`POST`), List (`GET`), Update (`PATCH`), Rotate Secret (`POST .../rotate-secret`), and Deactivate (`DELETE`).

### PATCH semantics

The `PATCH` endpoint accepts partial updates. Only fields present in the request body are modified. The management API should:
1. Verify the caller owns the client
2. Strip fields the user cannot control (`rate_limit`, `client_type`, `allowed_sign_methods`)
3. Forward the update to the auth gateway
4. Return the updated client

---

## Auth Gateway Endpoints (implemented)

Two new endpoints have been added:

### `PATCH /v1/admin/clients/:client_id`

**Mutable fields**: `client_name`, `redirect_uris`, `grant_types`, `allowed_scopes`, `allowed_origins`, `rate_limit`

**Immutable fields**: `client_type`, `allowed_sign_methods` (cannot be changed after creation)

Behavior:
1. Validates admin API key
2. Validates all field values using the same rules as the create endpoint
3. Enforces EVM scope restrictions if the client's sign method is `evm`
4. Updates the database row and invalidates the client cache
5. Returns the updated client

### `POST /v1/admin/clients/:client_id/rotate-secret`

Generates a new client secret, invalidating the old one immediately. Only works for confidential clients.

Returns the new `client_secret` (plaintext, one-time), `client_id`, `client_name`, and a confirmation message.

---

## UX Details

### Loading & Error States
- Skeleton loading for client list and detail views
- Inline validation errors on form fields (red border + message below field)
- Toast notifications for success actions ("Application updated", "Application deactivated")
- Error toasts for failed API calls with actionable messages

### Responsive
- Card layout for client list on mobile (stack vertically)
- Form sections stack vertically on all screen sizes
- Scope builder modal should work on mobile (full-screen sheet on small viewports)

### Confirmation Dialogs
- Deactivating a client: destructive confirmation dialog with the client name, requiring the user to type the client name or click a clearly-labeled destructive button
- Removing a redirect URI that is the last one (when authorization_code is selected): warning that this will break the auth code flow

### Copy Interactions
- Client ID: click-to-copy with brief "Copied!" tooltip
- Client secret (creation only): prominent copy button, field uses monospace font
