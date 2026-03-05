import { z } from 'zod';

export const DeviceCodeBodySchema = z.object({
  client_id: z.string(),
  scopes: z.array(z.string()).optional().default([]),
});

export const DeviceTokenBodySchema = z.object({
  device_code: z.string(),
  grant_type: z.string(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
});

export const UserCodeQuerySchema = z.object({
  user_code: z.string(),
});

export const OptionalUserCodeQuerySchema = z.object({
  user_code: z.string().optional(),
});

export const DeviceApproveBodySchema = z.object({
  user_code: z.string(),
  address: z.string(),
});

export const DeviceConfirmBodySchema = z.object({
  user_code: z.string(),
  address: z.string(),
  nonce: z.string(),
  signature: z.string(),
});
