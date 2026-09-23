import { resolveSigningKey } from '../../scopes/index';
import { SCOPE_REGISTRY } from '../../scopes/registry';

const HOTKEY = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

describe('resolveSigningKey', () => {
  test('miner and validator require a hotkey', () => {
    expect(resolveSigningKey(['subnet:1:miner'])).toBe('hotkey');
    expect(resolveSigningKey(['subnet:482:validator'])).toBe('hotkey');
  });

  test('coldkey-verified scopes resolve to coldkey', () => {
    expect(resolveSigningKey(['subnet:1:owner'])).toBe('coldkey');
    expect(resolveSigningKey(['subnet:1:holder:100'])).toBe('coldkey');
    expect(resolveSigningKey(['tao:holder'])).toBe('coldkey');
    expect(resolveSigningKey(['staker:100'])).toBe('coldkey');
    expect(resolveSigningKey([`delegate:${HOTKEY}`])).toBe('coldkey');
  });

  test('scopes with no on-chain check leave the choice open', () => {
    expect(resolveSigningKey([])).toBe('any');
    expect(resolveSigningKey(['openid'])).toBe('any');
  });

  test('a hotkey scope wins a mixed set — it resolves to its owning coldkey on chain', () => {
    expect(resolveSigningKey(['tao:holder', 'subnet:1:miner'])).toBe('hotkey');
    expect(resolveSigningKey(['subnet:1:miner', 'openid'])).toBe('hotkey');
  });

  test('coldkey wins over openid', () => {
    expect(resolveSigningKey(['openid', 'staker:1'])).toBe('coldkey');
  });

  test('unparseable scopes are ignored', () => {
    expect(resolveSigningKey(['not:a:scope'])).toBe('any');
    expect(resolveSigningKey(['not:a:scope', 'subnet:1:miner'])).toBe('hotkey');
  });

  test('every registered scope declares a signing key', () => {
    for (const def of SCOPE_REGISTRY) {
      const parsed = def.parse(
        Object.fromEntries(
          def.segments.flatMap((seg) => ('param' in seg ? [[seg.param, seg.param === 'hotkey' ? HOTKEY : '1']] : [])),
        ),
      );
      expect(['hotkey', 'coldkey', 'any']).toContain(def.signingKey(parsed));
    }
  });
});
