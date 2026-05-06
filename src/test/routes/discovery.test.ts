import { setupMockDb, createTestClient, addTestClient, clearTestClients } from '../helpers/mockDb';

// Setup mocks BEFORE imports
setupMockDb();

process.env.PUBLIC_URL = 'https://auth.taostats.io';
process.env.JWT_ISSUER = 'https://auth.taostats.io';

jest.mock('../../subtensor/client', () => ({
  getSubtensorApi: jest.fn(),
  disconnectSubtensor: jest.fn().mockResolvedValue(undefined),
  isSubtensorConnected: jest.fn().mockReturnValue(true),
}));

import { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers/app';

let app: FastifyInstance;
let doc: Record<string, unknown>;

beforeAll(async () => {
  clearTestClients();
  addTestClient(createTestClient());
  app = await buildTestApp();

  const res = await app.inject({
    method: 'GET',
    url: '/.well-known/openid-configuration',
  });
  expect(res.statusCode).toBe(200);
  doc = JSON.parse(res.payload);
});

afterAll(async () => {
  await app.close();
});

// Helpers for OIDC spec validation
function expectHttpsUrl(value: unknown, fieldName: string): void {
  expect(typeof value).toBe('string');
  const url = new URL(value as string);
  expect(url.protocol).toBe('https:');
  // Extra context on failure
  if (url.protocol !== 'https:') {
    throw new Error(`${fieldName} must use https scheme, got: ${value}`);
  }
}

function expectStringArray(value: unknown, fieldName: string): void {
  expect(Array.isArray(value)).toBe(true);
  for (const item of value as unknown[]) {
    if (typeof item !== 'string') {
      throw new Error(`${fieldName} must be an array of strings, found: ${typeof item}`);
    }
  }
}

describe('OAuth 2.0 Authorization Server Metadata (RFC 8414)', () => {
  // ── REQUIRED fields per Section 3 ──────────────────────────────────

  describe('REQUIRED fields', () => {
    test('issuer is present and is an HTTPS URL with no query or fragment', () => {
      expectHttpsUrl(doc.issuer, 'issuer');
      const url = new URL(doc.issuer as string);
      expect(url.search).toBe('');
      expect(url.hash).toBe('');
    });

    test('authorization_endpoint is present and is an HTTPS URL', () => {
      expectHttpsUrl(doc.authorization_endpoint, 'authorization_endpoint');
    });

    test('token_endpoint is present and is an HTTPS URL', () => {
      expectHttpsUrl(doc.token_endpoint, 'token_endpoint');
    });

    test('jwks_uri is present and is an HTTPS URL', () => {
      expectHttpsUrl(doc.jwks_uri, 'jwks_uri');
    });

    test('response_types_supported is a non-empty array of strings', () => {
      expectStringArray(doc.response_types_supported, 'response_types_supported');
      expect((doc.response_types_supported as string[]).length).toBeGreaterThan(0);
    });

    test('includes OIDC discovery fields', () => {
      expect(doc.subject_types_supported).toEqual(['public']);
      expect(doc.id_token_signing_alg_values_supported).toEqual(['RS256']);
      expect(doc.claims_supported).toEqual(
        expect.arrayContaining(['sub', 'iss', 'aud', 'nonce', 'at_hash', 'auth_time', 'hotkey', 'coldkey']),
      );
    });

    test('endpoint paths match actual routes', () => {
      const issuerOrigin = new URL(doc.issuer as string).origin;
      expect(new URL(doc.authorization_endpoint as string).pathname).toBe('/v1/oauth/authorize');
      expect(new URL(doc.token_endpoint as string).pathname).toBe('/v1/oauth/token');
      expect(new URL(doc.jwks_uri as string).pathname).toBe('/.well-known/jwks.json');
      expect(new URL(doc.device_authorization_endpoint as string).pathname).toBe('/v1/device/code');
      // All endpoints rooted under the issuer origin
      for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'device_authorization_endpoint']) {
        expect(new URL(doc[field] as string).origin).toBe(issuerOrigin);
      }
    });

    test('response_types_supported includes code', () => {
      expect(doc.response_types_supported).toContain('code');
    });

    test('scopes_supported includes openid', () => {
      expect(doc.scopes_supported).toContain('openid');
    });

    test('scopes_supported includes openid exactly once', () => {
      const supported: string[] = doc.scopes_supported;
      expect(supported.filter((s) => s === 'openid')).toHaveLength(1);
    });
  });

  // ── URL format checks ─────────────────────────────────────────────

  describe('endpoint URL formats', () => {
    test('all endpoint URLs are well-formed HTTPS URLs', () => {
      const endpointFields = ['authorization_endpoint', 'token_endpoint', 'device_authorization_endpoint', 'jwks_uri'];
      for (const field of endpointFields) {
        if (doc[field] !== undefined) {
          expectHttpsUrl(doc[field], field);
        }
      }
    });

    test('service_documentation, if present, is a valid URL', () => {
      if (doc.service_documentation !== undefined) {
        expect(typeof doc.service_documentation).toBe('string');
        expect(() => new URL(doc.service_documentation as string)).not.toThrow();
      }
    });
  });

  // ── Type validations for OPTIONAL array-of-string fields ──────────

  describe('array-of-string fields have correct types', () => {
    const arrayFields = [
      'response_types_supported',
      'grant_types_supported',
      'scopes_supported',
      'token_endpoint_auth_methods_supported',
      'code_challenge_methods_supported',
    ];

    for (const field of arrayFields) {
      test(`${field} is an array of strings (if present)`, () => {
        if (doc[field] !== undefined) {
          expectStringArray(doc[field], field);
        }
      });
    }
  });

  // ── Content-specific checks for our gateway ───────────────────────

  describe('gateway-specific values', () => {
    test('issuer matches JWT_ISSUER config', () => {
      expect(doc.issuer).toBe('https://auth.taostats.io');
    });

    test('grant_types_supported includes authorization_code, refresh_token, and device_code', () => {
      const grants = doc.grant_types_supported as string[];
      expect(grants).toContain('authorization_code');
      expect(grants).toContain('refresh_token');
      expect(grants).toContain('urn:ietf:params:oauth:grant-type:device_code');
    });

    test('token_endpoint_auth_methods_supported includes expected methods', () => {
      const methods = doc.token_endpoint_auth_methods_supported as string[];
      expect(methods).toContain('client_secret_basic');
      expect(methods).toContain('client_secret_post');
      expect(methods).toContain('none');
    });

    test('code_challenge_methods_supported includes S256', () => {
      expect(doc.code_challenge_methods_supported).toContain('S256');
    });

    test('device_authorization_endpoint is present for device code flow', () => {
      expectHttpsUrl(doc.device_authorization_endpoint, 'device_authorization_endpoint');
      expect(doc.device_authorization_endpoint).toContain('/v1/device/code');
    });

    test('endpoint URLs are rooted under the public URL', () => {
      const publicUrl = 'https://auth.taostats.io';
      const endpointFields = ['authorization_endpoint', 'token_endpoint', 'device_authorization_endpoint', 'jwks_uri'];
      for (const field of endpointFields) {
        if (doc[field] !== undefined) {
          expect((doc[field] as string).startsWith(publicUrl)).toBe(true);
        }
      }
    });
  });

  // ── Response headers ──────────────────────────────────────────────

  test('returns application/json content type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/openid-configuration',
    });
    expect(res.headers['content-type']).toContain('application/json');
  });

  test('returns Cache-Control header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/openid-configuration',
    });
    expect(res.headers['cache-control']).toContain('max-age=3600');
  });
});

describe('GET /v1/discovery/scope-config', () => {
  let scopeConfig: Record<string, unknown>;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/discovery/scope-config',
    });
    expect(res.statusCode).toBe(200);
    scopeConfig = JSON.parse(res.payload);
  });

  test('returns 200 with correct top-level shape', () => {
    expect(scopeConfig).toHaveProperty('scope_categories');
    expect(scopeConfig).toHaveProperty('grant_types');
    expect(scopeConfig).toHaveProperty('sign_methods');
    expect(scopeConfig).toHaveProperty('evm_scope_restriction');
  });

  test('scope_categories has entries for all 5 scope types', () => {
    const cats = scopeConfig.scope_categories as unknown[];
    expect(cats).toHaveLength(5);
  });

  test('each scope category has required fields', () => {
    const cats = scopeConfig.scope_categories as Record<string, unknown>[];
    for (const cat of cats) {
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
    const cats = scopeConfig.scope_categories as Record<string, unknown>[];
    for (const cat of cats) {
      const params = cat.parameters as Record<string, unknown>;
      expect(params.$schema).toBeDefined();
      expect(params.type).toBe('object');
      expect(params.properties).toBeDefined();
      expect(typeof params.properties).toBe('object');
    }
  });

  test('grant_types has 3 entries with correct ids', () => {
    const grants = scopeConfig.grant_types as Record<string, unknown>[];
    expect(grants).toHaveLength(3);
    const ids = grants.map((g) => g.id);
    expect(ids).toContain('authorization_code');
    expect(ids).toContain('refresh_token');
    expect(ids).toContain('urn:ietf:params:oauth:grant-type:device_code');
  });

  test('sign_methods has sr25519 and evm', () => {
    const methods = scopeConfig.sign_methods as Record<string, unknown>[];
    expect(methods).toHaveLength(2);
    const ids = methods.map((m) => m.id);
    expect(ids).toContain('sr25519');
    expect(ids).toContain('evm');
  });

  test('Cache-Control header is set', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/discovery/scope-config',
    });
    expect(res.headers['cache-control']).toContain('max-age=3600');
  });
});
