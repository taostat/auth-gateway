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

    test('does not include OIDC-only fields (not an OIDC provider)', () => {
      expect(doc.subject_types_supported).toBeUndefined();
      expect(doc.id_token_signing_alg_values_supported).toBeUndefined();
    });
  });

  // ── URL format checks ─────────────────────────────────────────────

  describe('endpoint URL formats', () => {
    test('all endpoint URLs are well-formed HTTPS URLs', () => {
      const endpointFields = [
        'authorization_endpoint',
        'token_endpoint',
        'device_authorization_endpoint',
        'jwks_uri',
      ];
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
      const endpointFields = [
        'authorization_endpoint',
        'token_endpoint',
        'device_authorization_endpoint',
        'jwks_uri',
      ];
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
