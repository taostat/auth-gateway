import { checkClientRateLimit, clearRateLimitCounters } from '../../middleware/clientRateLimit';
import { BoundedMap } from '../../util/boundedMap';

beforeEach(() => {
  clearRateLimitCounters();
});

describe('Client Rate Limit', () => {
  test('allows requests within limit', () => {
    expect(() => checkClientRateLimit('client-a', 5)).not.toThrow();
    expect(() => checkClientRateLimit('client-a', 5)).not.toThrow();
    expect(() => checkClientRateLimit('client-a', 5)).not.toThrow();
  });

  test('throws 429 when limit exceeded', () => {
    for (let i = 0; i < 3; i++) {
      checkClientRateLimit('client-b', 3);
    }
    expect(() => checkClientRateLimit('client-b', 3)).toThrow('Rate limit exceeded');
  });

  test('different clients have separate counters', () => {
    for (let i = 0; i < 3; i++) {
      checkClientRateLimit('client-c', 3);
    }
    // client-d should still be allowed
    expect(() => checkClientRateLimit('client-d', 3)).not.toThrow();
  });

  test('counter resets after window expires', () => {
    for (let i = 0; i < 3; i++) {
      checkClientRateLimit('client-e', 3);
    }
    expect(() => checkClientRateLimit('client-e', 3)).toThrow('Rate limit exceeded');

    // Simulate window expiry
    const original = Date.now;
    Date.now = () => original() + 61_000; // 61 seconds later

    expect(() => checkClientRateLimit('client-e', 3)).not.toThrow();

    Date.now = original;
  });

  test('limit of 0 means unlimited', () => {
    for (let i = 0; i < 100; i++) {
      expect(() => checkClientRateLimit('client-f', 0)).not.toThrow();
    }
  });

  test('error has correct status code', () => {
    try {
      for (let i = 0; i <= 1; i++) {
        checkClientRateLimit('client-g', 1);
      }
      fail('Should have thrown');
    } catch (err: any) {
      expect(err.statusCode).toBe(429);
      expect(err.error).toBe('Too Many Requests');
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
