import { SCOPE_REGISTRY, GRANT_TYPES, SIGN_METHODS, getScopeConfig, ScopeConfig } from '../../scopes/registry';

describe('SCOPE_REGISTRY', () => {
  test('contains 5 scope categories', () => {
    expect(SCOPE_REGISTRY).toHaveLength(5);
  });

  test('each entry has required fields', () => {
    for (const def of SCOPE_REGISTRY) {
      expect(typeof def.id).toBe('string');
      expect(typeof def.name).toBe('string');
      expect(typeof def.description).toBe('string');
      expect(typeof def.format).toBe('string');
      expect(def.regex).toBeInstanceOf(RegExp);
      expect(Array.isArray(def.sign_methods)).toBe(true);
      expect(typeof def.testnet_supported).toBe('boolean');
    }
  });

  test('has expected scope ids', () => {
    const ids = SCOPE_REGISTRY.map((d) => d.id);
    expect(ids).toContain('subnet_role');
    expect(ids).toContain('subnet_holder');
    expect(ids).toContain('tao_holder');
    expect(ids).toContain('delegator');
    expect(ids).toContain('staker');
  });

  test('testnet_supported is false for delegate and staker', () => {
    const delegator = SCOPE_REGISTRY.find((d) => d.id === 'delegator')!;
    const staker = SCOPE_REGISTRY.find((d) => d.id === 'staker')!;
    expect(delegator.testnet_supported).toBe(false);
    expect(staker.testnet_supported).toBe(false);
  });

  test('testnet_supported is true for subnet, subnet_holder, and tao_holder', () => {
    const subnetRole = SCOPE_REGISTRY.find((d) => d.id === 'subnet_role')!;
    const subnetHolder = SCOPE_REGISTRY.find((d) => d.id === 'subnet_holder')!;
    const taoHolder = SCOPE_REGISTRY.find((d) => d.id === 'tao_holder')!;
    expect(subnetRole.testnet_supported).toBe(true);
    expect(subnetHolder.testnet_supported).toBe(true);
    expect(taoHolder.testnet_supported).toBe(true);
  });

  describe('regex matches own templates', () => {
    const HOTKEY = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

    const sampleScopes: Record<string, string[]> = {
      subnet_role: ['subnet:1:miner', 'subnet:42:validator', 'subnet:0:owner'],
      subnet_holder: ['subnet:1:holder', 'subnet:1:holder:100', 'subnet:5:holder:0.5'],
      tao_holder: ['tao:holder', 'tao:holder:50', 'tao:holder:0.01'],
      delegator: [`delegate:${HOTKEY}`, `delegate:${HOTKEY}:500`, `delegate:${HOTKEY}:0.1`],
      staker: ['staker:1000', 'staker:0.001'],
    };

    for (const def of SCOPE_REGISTRY) {
      const samples = sampleScopes[def.id];
      if (!samples) continue;
      for (const scope of samples) {
        test(`${def.id} regex matches "${scope}"`, () => {
          expect(def.regex.test(scope)).toBe(true);
        });
      }
    }
  });

  describe('parse() produces valid ParsedScope from regex match', () => {
    const HOTKEY = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

    test('subnet_role parse', () => {
      const def = SCOPE_REGISTRY.find((d) => d.id === 'subnet_role')!;
      const match = 'subnet:1:miner'.match(def.regex)!;
      const parsed = def.parse(match);
      expect(parsed.type).toBe('subnet');
      expect(parsed.netuid).toBe(1);
      expect(parsed.role).toBe('miner');
    });

    test('subnet_holder parse with amount', () => {
      const def = SCOPE_REGISTRY.find((d) => d.id === 'subnet_holder')!;
      const match = 'subnet:1:holder:100'.match(def.regex)!;
      const parsed = def.parse(match);
      expect(parsed.type).toBe('subnet');
      expect(parsed.netuid).toBe(1);
      expect(parsed.role).toBe('holder');
      expect(parsed.minAmount).toBe(100_000_000_000n);
    });

    test('tao_holder parse without amount', () => {
      const def = SCOPE_REGISTRY.find((d) => d.id === 'tao_holder')!;
      const match = 'tao:holder'.match(def.regex)!;
      const parsed = def.parse(match);
      expect(parsed.type).toBe('tao');
      expect(parsed.role).toBe('holder');
      expect(parsed.minAmount).toBeUndefined();
    });

    test('delegator parse', () => {
      const def = SCOPE_REGISTRY.find((d) => d.id === 'delegator')!;
      const match = `delegate:${HOTKEY}:500`.match(def.regex)!;
      const parsed = def.parse(match);
      expect(parsed.type).toBe('delegate');
      expect(parsed.hotkey).toBe(HOTKEY);
      expect(parsed.minAmount).toBe(500_000_000_000n);
    });

    test('staker parse', () => {
      const def = SCOPE_REGISTRY.find((d) => d.id === 'staker')!;
      const match = 'staker:1000'.match(def.regex)!;
      const parsed = def.parse(match);
      expect(parsed.type).toBe('staker');
      expect(parsed.minAmount).toBe(1_000_000_000_000n);
    });
  });
});

describe('GRANT_TYPES', () => {
  test('has 3 entries', () => {
    expect(GRANT_TYPES).toHaveLength(3);
  });

  test('includes authorization_code, refresh_token, and device_code', () => {
    const ids = GRANT_TYPES.map((g) => g.id);
    expect(ids).toContain('authorization_code');
    expect(ids).toContain('refresh_token');
    expect(ids).toContain('urn:ietf:params:oauth:grant-type:device_code');
  });

  test('each entry has id, name, description, requires_redirect_uri', () => {
    for (const gt of GRANT_TYPES) {
      expect(typeof gt.id).toBe('string');
      expect(typeof gt.name).toBe('string');
      expect(typeof gt.description).toBe('string');
      expect(typeof gt.requires_redirect_uri).toBe('boolean');
    }
  });
});

describe('SIGN_METHODS', () => {
  test('has sr25519 and evm', () => {
    const ids = SIGN_METHODS.map((m) => m.id);
    expect(ids).toContain('sr25519');
    expect(ids).toContain('evm');
  });

  test('each entry has id, name, description', () => {
    for (const sm of SIGN_METHODS) {
      expect(typeof sm.id).toBe('string');
      expect(typeof sm.name).toBe('string');
      expect(typeof sm.description).toBe('string');
    }
  });
});

describe('getScopeConfig', () => {
  test('returns all 5 scope categories', () => {
    const cfg = getScopeConfig();
    expect(cfg.scope_categories).toHaveLength(5);
  });

  test('caches result (returns same reference on second call)', () => {
    const first = getScopeConfig();
    const second = getScopeConfig();
    expect(first).toBe(second);
  });

  test('each scope category has required shape', () => {
    const cfg = getScopeConfig();
    for (const cat of cfg.scope_categories) {
      expect(typeof cat.id).toBe('string');
      expect(typeof cat.name).toBe('string');
      expect(typeof cat.description).toBe('string');
      expect(typeof cat.format).toBe('string');
      expect(typeof cat.parameters).toBe('object');
      expect(Array.isArray(cat.sign_methods)).toBe(true);
      expect(typeof cat.testnet_supported).toBe('boolean');
    }
  });

  test('parameters is a valid JSON Schema object', () => {
    const cfg = getScopeConfig();
    for (const cat of cfg.scope_categories) {
      const params = cat.parameters as Record<string, unknown>;
      expect(params.$schema).toBeDefined();
      expect(params.type).toBe('object');
      expect(params.properties).toBeDefined();
      expect(typeof params.properties).toBe('object');
    }
  });

  test('includes grant_types and sign_methods', () => {
    const cfg = getScopeConfig();
    expect(cfg.grant_types).toBe(GRANT_TYPES);
    expect(cfg.sign_methods).toBe(SIGN_METHODS);
  });

  test('includes evm_scope_restriction string', () => {
    const cfg = getScopeConfig();
    expect(typeof cfg.evm_scope_restriction).toBe('string');
    expect(cfg.evm_scope_restriction.length).toBeGreaterThan(0);
  });
});
