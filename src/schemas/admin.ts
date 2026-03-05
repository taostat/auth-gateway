import { z } from 'zod';

export const CreateClientBodySchema = z.object({
  client_name: z.string(),
  client_type: z.enum(['confidential', 'public']),
  redirect_uris: z.array(z.string()).optional().default([]),
  grant_types: z.array(z.enum(['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'])).optional(),
  allowed_scopes: z.array(z.string().regex(/^subnet:\d+:(miner|owner|validator|holder)$/)).optional(),
  allowed_origins: z.array(z.string()).optional(),
  rate_limit: z.number().optional(),
});

export const ClientIdParamsSchema = z.object({
  client_id: z.string(),
});
