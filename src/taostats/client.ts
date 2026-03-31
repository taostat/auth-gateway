import { config } from '../config';
import { BoundedMap } from '../util/boundedMap';

const TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 60000;
const CACHE_MAX_SIZE = 256;

export interface TaostatsApiResponse<T> {
  pagination: {
    current_page: number;
    total_items: number;
    total_pages: number;
  };
  data: T[];
}

interface CacheEntry {
  data: TaostatsApiResponse<unknown>;
  fetchedAt: number;
}

const cache = new BoundedMap<string, CacheEntry>(
  CACHE_MAX_SIZE,
  (entry) => Date.now() - entry.fetchedAt > CACHE_TTL_MS,
);

function buildCacheKey(path: string, params: Record<string, string>): string {
  const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  return `${path}?${sorted.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

/**
 * Parse a decimal TAO string (e.g. "1234.567890123") to RAO bigint
 * without floating-point precision loss.
 */
export function taoStringToRao(s: string): bigint {
  const [whole = '0', frac = ''] = s.split('.');
  const padded = frac.padEnd(9, '0').slice(0, 9);
  return BigInt(whole) * BigInt(1_000_000_000) + BigInt(padded);
}

/**
 * Fetch from the Taostats API with auth, timeout, and 60s cache.
 * Throws if TAOSTATS_API_KEY is not configured.
 */
export async function taostatsGet<T>(path: string, params: Record<string, string>): Promise<TaostatsApiResponse<T>> {
  if (!config.taostatsApiKey) {
    throw new Error('TAOSTATS_API_KEY is required for Taostats API scopes');
  }

  const cacheKey = buildCacheKey(path, params);
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached.data as TaostatsApiResponse<T>;
  }

  const url = new URL(path, config.taostatsApiUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    headers: { Authorization: config.taostatsApiKey },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Taostats API ${response.status}: ${url.pathname}`);
  }

  const data = (await response.json()) as TaostatsApiResponse<T>;
  cache.set(cacheKey, { data, fetchedAt: Date.now() });
  return data;
}
