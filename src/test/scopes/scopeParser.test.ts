import {
  parseScope,
  validateScopeFormat,
  validateAllowedScopeFormat,
  describeScope,
  enforceClientScopes,
  isScopeAllowedForClient,
  validateScopesForSignMethod,
} from '../../scopes/index';
import { taoStringToRao } from '../../taostats/client';

const RAO = 1_000_000_000n;
const HOTKEY = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

describe('parseScope', () => {
  test('subnet:1:miner', () => {
    const p = parseScope('subnet:1:miner');
    expect(p.type).toBe('subnet');
    expect(p.netuid).toBe(1);
    expect(p.role).toBe('miner');
    expect(p.minAmount).toBeUndefined();
  });

  test('subnet:1:holder:100 (min alpha)', () => {
    const p = parseScope('subnet:1:holder:100');
    expect(p.type).toBe('subnet');
    expect(p.role).toBe('holder');
    expect(p.netuid).toBe(1);
    expect(p.minAmount).toBe(100n * RAO);
  });

  test('tao:holder', () => {
    const p = parseScope('tao:holder');
    expect(p.type).toBe('tao');
    expect(p.minAmount).toBeUndefined();
  });

  test('tao:holder:50', () => {
    const p = parseScope('tao:holder:50');
    expect(p.type).toBe('tao');
    expect(p.minAmount).toBe(50n * RAO);
  });

  test('delegate:{hotkey}', () => {
    const p = parseScope(`delegate:${HOTKEY}`);
    expect(p.type).toBe('delegate');
    expect(p.hotkey).toBe(HOTKEY);
    expect(p.minAmount).toBeUndefined();
  });

  test('delegate:{hotkey}:500', () => {
    const p = parseScope(`delegate:${HOTKEY}:500`);
    expect(p.type).toBe('delegate');
    expect(p.hotkey).toBe(HOTKEY);
    expect(p.minAmount).toBe(500n * RAO);
  });

  test('staker:1000', () => {
    const p = parseScope('staker:1000');
    expect(p.type).toBe('staker');
    expect(p.minAmount).toBe(1000n * RAO);
  });

  test('tao:holder:0.01 (fractional)', () => {
    const p = parseScope('tao:holder:0.01');
    expect(p.type).toBe('tao');
    expect(p.minAmount).toBe(10_000_000n);
  });

  test('subnet:1:holder:0.5 (fractional alpha)', () => {
    const p = parseScope('subnet:1:holder:0.5');
    expect(p.minAmount).toBe(500_000_000n);
  });

  test('staker:0.001', () => {
    const p = parseScope('staker:0.001');
    expect(p.minAmount).toBe(1_000_000n);
  });

  test('delegate with fractional min', () => {
    const p = parseScope(`delegate:${HOTKEY}:0.1`);
    expect(p.minAmount).toBe(100_000_000n);
  });

  test('invalid scope throws', () => {
    expect(() => parseScope('invalid')).toThrow('Invalid scope format');
    expect(() => parseScope('subnet:abc:miner')).toThrow();
    expect(() => parseScope('staker')).toThrow();
  });
});

describe('validateScopeFormat', () => {
  const valid = [
    'openid',
    'subnet:1:miner',
    'subnet:42:validator',
    'subnet:1:owner',
    'subnet:1:holder',
    'subnet:1:holder:100',
    'tao:holder',
    'tao:holder:50',
    `delegate:${HOTKEY}`,
    `delegate:${HOTKEY}:500`,
    `delegate:${HOTKEY}:0.5`,
    'staker:1000',
    'staker:0.01',
    'tao:holder:0.001',
    'subnet:1:holder:0.5',
  ];

  for (const scope of valid) {
    test(`valid: ${scope}`, () => {
      expect(validateScopeFormat(scope)).toBe(true);
    });
  }

  const invalid = [
    'invalid',
    'subnet:abc:miner',
    'subnet:1:hacker',
    'tao:miner',
    'subnet:1:miner:100',
    'subnet:1:validator:50',
    'delegate:not-a-key',
    'staker',
    'staker:abc',
  ];

  for (const scope of invalid) {
    test(`invalid: ${scope}`, () => {
      expect(validateScopeFormat(scope)).toBe(false);
    });
  }
});

describe('validateAllowedScopeFormat', () => {
  const valid = [
    'openid',
    'subnet:1:miner',
    'subnet:*:miner',
    'subnet:*:validator',
    'subnet:*:owner',
    'subnet:*:holder',
    'subnet:*:holder:100',
    'subnet:1:holder:*',
    'subnet:*:holder:*',
    'subnet:1:*',
    'tao:holder:*',
    `delegate:${HOTKEY}`,
    'delegate:*',
    'delegate:*:*',
    'staker:*',
  ];

  for (const entry of valid) {
    test(`valid: ${entry}`, () => {
      expect(validateAllowedScopeFormat(entry)).toBe(true);
    });
  }

  const invalid = [
    'banana:*:foo',
    'subnet:*:miner:*',
    '*',
    '*:*:*:*:*',
    'subnet:1:hacker',
    'tao:*:*:*',
    // Wildcard shape matches a template, but a literal segment cannot satisfy
    // the parameter type (numeric netuid, amount, or SS58 hotkey).
    'delegate:*:abc',
    '*:abc:miner',
    'subnet:*:holder:',
    'staker:*:*',
    // Literal segments (`subnet`, `tao`, `delegate`, `staker`, `holder`) are
    // part of a scope's identity and cannot be wildcarded — `*` only
    // substitutes for parameter values, never for literals.
    '*:*:owner',
    '*:1:miner',
    'tao:*',
  ];

  for (const entry of invalid) {
    test(`invalid: ${entry}`, () => {
      expect(validateAllowedScopeFormat(entry)).toBe(false);
    });
  }
});

describe('describeScope', () => {
  test('subnet scopes', () => {
    expect(describeScope('subnet:1:validator')).toBe('Validator on Subnet 1');
    expect(describeScope('subnet:1:holder:100')).toBe('Token Holder on Subnet 1 (min 100 alpha)');
  });

  test('tao scopes', () => {
    expect(describeScope('tao:holder')).toBe('TAO Holder');
    expect(describeScope('tao:holder:50')).toBe('TAO Holder (min 50 TAO)');
    expect(describeScope('tao:holder:0.01')).toBe('TAO Holder (min 0.01 TAO)');
  });

  test('delegate scopes', () => {
    const desc = describeScope(`delegate:${HOTKEY}`);
    expect(desc).toContain('Delegator to');
    expect(desc).toContain('5GrwvaEF');
  });

  test('staker scopes', () => {
    expect(describeScope('staker:1000')).toBe('Staker (min 1000 TAO total)');
  });
});

describe('enforceClientScopes', () => {
  test('empty allowed_scopes permits everything', () => {
    expect(() => enforceClientScopes(['subnet:1:miner', 'tao:holder'], [])).not.toThrow();
  });

  test('exact match passes', () => {
    expect(() => enforceClientScopes(['subnet:1:holder:100'], ['subnet:1:holder:100'])).not.toThrow();
  });

  test('base scope allows parametric variant', () => {
    expect(() => enforceClientScopes(['subnet:1:holder:100'], ['subnet:1:holder'])).not.toThrow();
  });

  test('base delegate allows parametric variant', () => {
    expect(() => enforceClientScopes([`delegate:${HOTKEY}:500`], [`delegate:${HOTKEY}`])).not.toThrow();
  });

  test('base tao:holder allows parametric variant', () => {
    expect(() => enforceClientScopes(['tao:holder:100'], ['tao:holder'])).not.toThrow();
  });

  test('staker scope must be explicitly allowed', () => {
    expect(() => enforceClientScopes(['staker:1000'], ['subnet:1:miner'])).toThrow('not allowed');
  });

  test('explicit staker scope allows request', () => {
    expect(() => enforceClientScopes(['staker:1000'], ['staker:1000'])).not.toThrow();
  });

  test('disallowed scope throws', () => {
    expect(() => enforceClientScopes(['subnet:1:miner'], ['subnet:2:miner'])).toThrow('not allowed');
  });

  test('metadata scopes always pass', () => {
    expect(() => enforceClientScopes(['openid'], ['subnet:1:miner'])).not.toThrow();
  });

  test('staker scope must be explicitly allowed', () => {
    expect(() => enforceClientScopes(['staker:1000'], ['subnet:1:miner'])).toThrow('not allowed');
  });

  test('staker scope passes when explicitly listed', () => {
    expect(() => enforceClientScopes(['staker:1000'], ['staker:1000'])).not.toThrow();
  });

  test('wildcard segment matches any value at that position', () => {
    expect(() => enforceClientScopes(['subnet:42:owner'], ['subnet:*:owner'])).not.toThrow();
  });

  test('wildcard does not bridge differing literal segments', () => {
    expect(() => enforceClientScopes(['subnet:42:miner'], ['subnet:*:owner'])).toThrow('not allowed');
  });

  test('wildcard rejects requests with extra segments', () => {
    // 4-segment request never matches a 3-segment allowed entry, regardless of wildcards.
    expect(() => enforceClientScopes(['subnet:42:owner:foo'], ['subnet:*:owner'])).toThrow();
  });

  test('wildcard composes with minAmount stripping', () => {
    expect(() => enforceClientScopes(['subnet:42:holder:100'], ['subnet:*:holder'])).not.toThrow();
  });

  test('wildcard cannot substitute for a literal segment (subnet)', () => {
    // `*` in the `subnet` slot is a literal-wildcard — would cross-authorize
    // unrelated scope categories. Denied at admin time and at runtime.
    expect(() => enforceClientScopes(['subnet:1:miner'], ['*:1:miner'])).toThrow('not allowed');
    expect(() => enforceClientScopes(['subnet:42:owner'], ['*:*:owner'])).toThrow('not allowed');
  });

  test('wildcard cannot cross scope categories', () => {
    // `subnet:1:*` is a valid `subnet_role` allowlist entry (role is a
    // parameter), but cannot authorize a `subnet_holder` request because
    // `holder` is a literal in subnet_holder, not a wildcardable param.
    expect(() => enforceClientScopes(['subnet:1:holder'], ['subnet:1:*'])).toThrow('not allowed');
  });

  test('wildcard at the end segment', () => {
    expect(() => enforceClientScopes(['subnet:1:miner'], ['subnet:1:*'])).not.toThrow();
  });

  test('allowlist mixing literal and wildcard entries', () => {
    expect(() =>
      enforceClientScopes(['subnet:7:owner', 'staker:1000'], ['subnet:*:owner', 'staker:1000']),
    ).not.toThrow();
  });

  test('literal entry preserves prior strict semantics', () => {
    expect(() => enforceClientScopes(['subnet:42:owner'], ['subnet:42:owner'])).not.toThrow();
    expect(() => enforceClientScopes(['subnet:43:owner'], ['subnet:42:owner'])).toThrow('not allowed');
  });

  test('differing segment count is denied even with wildcards', () => {
    expect(() => enforceClientScopes(['subnet:1:owner'], ['*:*:*:*'])).toThrow('not allowed');
  });

  test('literal segment mismatch denies otherwise-matching wildcard entry', () => {
    expect(() => enforceClientScopes(['subnet:1:miner'], ['tao:*:miner'])).toThrow('not allowed');
  });
});

describe('isScopeAllowedForClient', () => {
  test('empty allowlist permits any scope', () => {
    expect(isScopeAllowedForClient('subnet:1:miner', [])).toBe(true);
  });

  test('metadata scopes always allowed', () => {
    expect(isScopeAllowedForClient('openid', ['subnet:1:miner'])).toBe(true);
  });

  test('literal allowlist entry permits exact match', () => {
    expect(isScopeAllowedForClient('subnet:1:miner', ['subnet:1:miner'])).toBe(true);
  });

  test('wildcard allowlist entry permits matching scope', () => {
    expect(isScopeAllowedForClient('subnet:42:owner', ['subnet:*:owner'])).toBe(true);
  });

  test('wildcard allowlist entry denies non-matching scope', () => {
    expect(isScopeAllowedForClient('staker:1000', ['subnet:*:owner'])).toBe(false);
  });

  test('wildcard composes with minAmount stripping', () => {
    expect(isScopeAllowedForClient('subnet:42:holder:100', ['subnet:*:holder'])).toBe(true);
  });

  test('unparseable requested scope is not allowed', () => {
    expect(isScopeAllowedForClient('not-a-scope', ['subnet:*:owner'])).toBe(false);
  });
});

describe('validateScopesForSignMethod', () => {
  test('sr25519 allows all scope types', () => {
    const scopes = ['openid', 'subnet:1:miner', 'tao:holder', `delegate:${HOTKEY}`, 'staker:1000'];
    expect(() => validateScopesForSignMethod(scopes, 'sr25519')).not.toThrow();
  });

  test('evm allows openid', () => {
    expect(() => validateScopesForSignMethod(['openid'], 'evm')).not.toThrow();
  });

  test('evm rejects subnet scope', () => {
    expect(() => validateScopesForSignMethod(['subnet:1:miner'], 'evm')).toThrow('not available for EVM');
  });

  test('evm rejects tao scope', () => {
    expect(() => validateScopesForSignMethod(['tao:holder'], 'evm')).toThrow('not available for EVM');
  });

  test('evm rejects delegate scope', () => {
    expect(() => validateScopesForSignMethod([`delegate:${HOTKEY}`], 'evm')).toThrow('not available for EVM');
  });

  test('evm rejects staker scope', () => {
    expect(() => validateScopesForSignMethod(['staker:1000'], 'evm')).toThrow('not available for EVM');
  });
});

describe('taoStringToRao', () => {
  test('whole number', () => {
    expect(taoStringToRao('100')).toBe(100_000_000_000n);
  });

  test('decimal value', () => {
    expect(taoStringToRao('1.5')).toBe(1_500_000_000n);
  });

  test('full 9-digit precision', () => {
    expect(taoStringToRao('1.123456789')).toBe(1_123_456_789n);
  });

  test('truncates beyond 9 digits', () => {
    expect(taoStringToRao('1.1234567899')).toBe(1_123_456_789n);
  });

  test('large value preserves precision', () => {
    expect(taoStringToRao('999999999.999999999')).toBe(999_999_999_999_999_999n);
  });

  test('zero', () => {
    expect(taoStringToRao('0')).toBe(0n);
  });

  test('zero with decimal', () => {
    expect(taoStringToRao('0.0')).toBe(0n);
  });
});
