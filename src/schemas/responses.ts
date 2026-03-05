import { z } from 'zod';

export const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  token_type: z.literal('Bearer'),
  expires_in: z.number(),
  scope: z.string(),
});

export const ChallengeResponseSchema = z.object({
  nonce: z.string(),
  expires_in: z.number(),
});

export const DeviceCodeResponseSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  expires_in: z.number(),
  interval: z.number(),
});

export const ErrorResponseSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
  statusCode: z.number().optional(),
  message: z.string().optional(),
});

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  network: z.enum(['mainnet', 'testnet']),
  subtensor: z.boolean(),
  database: z.boolean().optional(),
  uptime: z.number(),
});

export type TokenResponse = z.infer<typeof TokenResponseSchema>;
export type ChallengeResponse = z.infer<typeof ChallengeResponseSchema>;
export type DeviceCodeResponse = z.infer<typeof DeviceCodeResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
