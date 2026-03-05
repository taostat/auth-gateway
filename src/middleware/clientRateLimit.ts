import { AuthError } from '../util/errors';
import { BoundedMap } from '../util/boundedMap';

interface RateWindow {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 60_000; // 1 minute

const counters = new BoundedMap<string, RateWindow>(
  10_000,
  (entry) => Date.now() - entry.windowStart > WINDOW_MS,
);

/**
 * Check per-client rate limit. Throws 429 if the client has exceeded
 * their configured rate_limit within the current 1-minute window.
 */
export function checkClientRateLimit(clientId: string, limit: number): void {
  if (limit <= 0) return; // 0 = unlimited

  const now = Date.now();
  const existing = counters.get(clientId);

  if (!existing || now - existing.windowStart > WINDOW_MS) {
    counters.set(clientId, { count: 1, windowStart: now });
    return;
  }

  existing.count++;
  if (existing.count > limit) {
    throw new AuthError('Rate limit exceeded for this client', 429, 'Too Many Requests');
  }
}

/** For testing */
export function clearRateLimitCounters(): void {
  counters.clear();
}
