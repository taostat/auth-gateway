jest.mock('../../db/events', () => ({
  recordEvent: jest.fn().mockResolvedValue(undefined),
}));

import { checkClientRateLimit, clearRateLimitCounters } from '../../middleware/clientRateLimit';
import { BoundedMap } from '../../util/boundedMap';

beforeEach(() => {
  clearRateLimitCounters();
});

describe('Client Rate Limit', () => {
  test('allows requests within limit', () => {
    expect(() => checkClientRateLimit('client-a', 5, 'token')).not.toThrow();
    expect(() => checkClientRateLimit('client-a', 5, 'token')).not.toThrow();
    expect(() => checkClientRateLimit('client-a', 5, 'token')).not.toThrow();
  });

  test('throws 429 when limit exceeded', () => {
    for (let i = 0; i < 3; i++) {
      checkClientRateLimit('client-b', 3, 'token');
    }
    expect(() => checkClientRateLimit('client-b', 3, 'token')).toThrow('Rate limit exceeded');
  });

  test('different clients have separate counters', () => {
    for (let i = 0; i < 3; i++) {
      checkClientRateLimit('client-c', 3, 'token');
    }
    // client-d should still be allowed
    expect(() => checkClientRateLimit('client-d', 3, 'token')).not.toThrow();
  });

  test('counter resets after window expires', () => {
    for (let i = 0; i < 3; i++) {
      checkClientRateLimit('client-e', 3, 'token');
    }
    expect(() => checkClientRateLimit('client-e', 3, 'token')).toThrow('Rate limit exceeded');

    // Simulate window expiry
    const original = Date.now;
    Date.now = () => original() + 61_000; // 61 seconds later

    expect(() => checkClientRateLimit('client-e', 3, 'token')).not.toThrow();

    Date.now = original;
  });

  test('limit of 0 means unlimited', () => {
    for (let i = 0; i < 100; i++) {
      expect(() => checkClientRateLimit('client-f', 0, 'token')).not.toThrow();
    }
  });

  test('error has correct status code', () => {
    try {
      for (let i = 0; i <= 1; i++) {
        checkClientRateLimit('client-g', 1, 'token');
      }
      fail('Should have thrown');
    } catch (err: any) {
      expect(err.statusCode).toBe(429);
      expect(err.error).toBe('Too Many Requests');
    }
  });

  test('rate-limit error carries retryAfter in seconds', () => {
    checkClientRateLimit('client-h', 1, 'token');
    try {
      checkClientRateLimit('client-h', 1, 'token');
      fail('Should have thrown');
    } catch (err: any) {
      expect(err.name).toBe('RateLimitError');
      expect(err.retryAfter).toBeGreaterThanOrEqual(1);
      expect(err.retryAfter).toBeLessThanOrEqual(60);
    }
  });

  test('slowDownOnExceed throws SlowDownError instead of 429', () => {
    checkClientRateLimit('client-i', 1, 'token', { slowDownOnExceed: true });
    try {
      checkClientRateLimit('client-i', 1, 'token', { slowDownOnExceed: true });
      fail('Should have thrown');
    } catch (err: any) {
      expect(err.name).toBe('SlowDownError');
      expect(err.statusCode).toBe(400);
      expect(err.error).toBe('slow_down');
    }
  });
});

describe('BoundedMap', () => {
  test('evicts oldest entry when at capacity', () => {
    const map = new BoundedMap<string, number>(3, () => false);

    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);
    expect(map.size).toBe(3);

    // Add 4th entry — oldest ('a') should be evicted
    map.set('d', 4);
    expect(map.size).toBe(3);
    expect(map.has('a')).toBe(false);
    expect(map.has('d')).toBe(true);
    expect(map.get('d')).toBe(4);
  });
});
