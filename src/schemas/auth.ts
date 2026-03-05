import { z } from 'zod';

export const ChallengeBodySchema = z.object({
  address: z.string().optional(),
  scopes: z.array(z.string()).optional().default([]),
});

export const VerifyBodySchema = z.object({
  nonce: z.string(),
  address: z.string(),
  signature: z.string(),
});
