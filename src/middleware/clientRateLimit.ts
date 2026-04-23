import { RateLimitError, SlowDownError } from '../util/errors';
import { BoundedMap } from '../util/boundedMap';
import { recordRateLimitHit } from '../metrics/registry';
import { recordEvent } from '../db/events';

interface RateWindow {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 60_000; // 1 minute

const counters = new BoundedMap<string, RateWindow>(10_000, (entry) => Date.now() - entry.windowStart > WINDOW_MS);

export interface RateLimitOptions {
  /**
   * If true, throw SlowDownError (RFC 8628 `slow_down`) instead of a generic
   * 429. Use for device-code polling so CLIs get an OAuth error code they
   * recognize and back off correctly.
   */
  slowDownOnExceed?: boolean;
}

/**
 * Check per-client rate limit within a fixed 1-minute window. Throws on
 * exceed — either RateLimitError (HTTP 429 with Retry-After) or, when
 * `slowDownOnExceed` is set, SlowDownError (HTTP 400 `slow_down`).
 */
export function checkClientRateLimit(
  clientId: string,
  limit: number,
  endpoint: string,
  opts: RateLimitOptions = {},
): void {
  if (limit <= 0) return; // 0 = unlimited

  const now = Date.now();
  const existing = counters.get(clientId);

  if (!existing || now - existing.windowStart > WINDOW_MS) {
    counters.set(clientId, { count: 1, windowStart: now });
    return;
  }

  existing.count++;
  if (existing.count > limit) {
    recordRateLimitHit({ client_id: clientId, endpoint });
    recordEvent({
      client_id: clientId,
      event_type: 'rate_limit_hit',
      outcome: 'failure',
      metadata: { endpoint },
    }).catch(() => {});

    if (opts.slowDownOnExceed) {
      throw new SlowDownError();
    }

    const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - existing.windowStart)) / 1000));
    throw new RateLimitError(retryAfter);
  }
}

/** For testing */
export function clearRateLimitCounters(): void {
  counters.clear();
}
