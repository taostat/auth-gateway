import { z } from 'zod';

export const WindowSchema = z.enum(['24h', '7d', '30d']);

export const StatsQuerySchema = z.object({
  window: WindowSchema.optional().default('24h'),
});

export const OverviewQuerySchema = z.object({
  window: WindowSchema.optional().default('7d'),
});

// Composite cursor "<ISO occurred_at>|<event id>" breaks ties on duplicate timestamps.
export const EVENTS_CURSOR_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})\|[0-9a-fA-F-]{36}$/;

export const EventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  before: z.string().regex(EVENTS_CURSOR_REGEX).optional(),
});
