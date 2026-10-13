import { z } from 'zod';

export const AuthPurposeSchema = z.enum(['login', 'link']);

export const ChallengeBodySchema = z.object({
  address: z.string().optional(),
  scopes: z.array(z.string()).optional().default([]),
  client_id: z
    .string()
    .regex(/^[\x21-\x39\x3b-\x7e]+$/, 'client_id must contain visible ASCII characters other than colons')
    .optional(),
  purpose: AuthPurposeSchema.optional(),
  context: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/, 'context must be 1-64 letters, digits, dots, underscores, or hyphens')
    .optional(),
});

export const VerifyBodySchema = z.object({
  nonce: z.string(),
  address: z.string(),
  signature: z.string(),
});
