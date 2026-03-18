import { parseScope, validateScopeFormat, describeScope, enforceClientScopes } from '../../scopes/index';
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
