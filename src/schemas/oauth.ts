import { z } from 'zod';

export const AuthorizeQuerySchema = z.object({
  client_id: z.string().optional(),
  redirect_uri: z.string().optional(),
  scope: z.string().optional(),
  state: z.string().optional(),
  response_type: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
});

export const CallbackBodySchema = z.object({
  nonce: z.string(),
  address: z.string(),
  signature: z.string(),
  client_id: z.string(),
  redirect_uri: z.string().optional(),
  code_challenge: z.string().optional(),
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