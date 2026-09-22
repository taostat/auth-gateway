import { z } from 'zod';

export const AuthorizeQuerySchema = z.object({
  client_id: z.string().optional(),
  redirect_uri: z.string().optional(),
  scope: z.string().optional(),
  state: z.string().optional(),
  response_type: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
  nonce: z.string().optional(),
  /**
   * Presentation hint for the authorize page. "cli" opens the btcli signing
   * view and requests the challenge immediately; "browser" shows the browser
   * wallet view. Omitted keeps the default (browser view with a CLI switch).
   * Validated in the route so the user sees the styled HTML error page.
   */
  wallet_mode: z.string().optional(),
});

export const CallbackBodySchema = z.object({
  session_id: z.string(),
  nonce: z.string(),
  address: z.string(),
  signature: z.string(),
});

export const OAuthChallengeBodySchema = z.object({
  session_id: z.string(),
  address: z.string().optional(),
});

export const TokenBodySchema = z.object({
  grant_type: z.string(),
  // authorization_code
  code: z.string().optional(),
  redirect_uri: z.string().optional(),
  code_verifier: z.string().optional(),
  // refresh_token
  refresh_token: z.string().optional(),
  // device_code
  device_code: z.string().optional(),
  // client auth
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
});
