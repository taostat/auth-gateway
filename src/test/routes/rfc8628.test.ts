import { cryptoWaitReady } from '@polkadot/util-crypto';
import {
  setupMockDb,
  createTestClient,
  createPublicTestClient,
  addTestClient,
  clearTestClients,
  clearTestRefreshTokens,
  clearTestChallenges,
  clearTestDeviceCodes,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
} from '../helpers/mockDb';
import { createMockApi, MockChainBuilder } from '../helpers/mockSubtensor';

setupMockDb();

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

const builder = new MockChainBuilder();
builder.setMiner(ALICE, 1, 5);
const mockApi = createMockApi(builder.getState());

jest.mock('../../subtensor/client', () => ({
  getSubtensorApi: jest.fn().mockResolvedValue(mockApi),
  disconnectSubtensor: jest.fn().mockResolvedValue(undefined),
  isSubtensorConnected: jest.fn().mockReturnValue(true),
}));

jest.mock('../../subtensor/queries', () => {
  const actual = jest.requireActual('../../subtensor/queries');
  return {
    ...actual,
    getCurrentEpoch: jest.fn().mockResolvedValue(100),
    getSecondsUntilNextEpoch: jest.fn().mockResolvedValue(600),
    getEpochDetails: jest.fn().mockResolvedValue({ secondsUntilNextEpoch: 600, currentEpoch: 100 }),
  };
});

import { FastifyInstance } from 'fastify';
import { browserGet, browserPost, buildTestApp } from '../helpers/app';
import { getAliceAddress, signWithAlice } from '../helpers/sign';
import { getDeviceCode, denyDeviceCode } from '../../db/deviceCodes';

let app: FastifyInstance;

beforeAll(async () => {
  await cryptoWaitReady();
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  clearTestChallenges();
  clearTestDeviceCodes();
  clearTestClients();
  clearTestRefreshTokens();
  addTestClient(createTestClient());
  addTestClient(createPublicTestClient());
});

async function requestDeviceCode(payload?: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/v1/device/code',
    payload: {
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
      ...payload,
    },
  });
}

async function requestPublicDeviceCode(payload?: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/v1/device/code',
    payload: {
      client_id: 'public-test-client',
      ...payload,
    },
  });
}

async function pollToken(deviceCode: string, clientId?: string, clientSecret?: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/oauth/token',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: clientId ?? TEST_CLIENT_ID,
      client_secret: clientSecret ?? TEST_CLIENT_SECRET,
    },
  });
}

describe('RFC 8628 Compliance', () => {
  describe('3.1 Device Authorization Request', () => {
    test('confidential client MUST authenticate — missing secret returns 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/device/code',
        payload: { client_id: TEST_CLIENT_ID },
      });
      expect(res.statusCode).toBe(401);
    });

    test('public client provides client_id without secret', async () => {
      const res = await requestPublicDeviceCode();
      expect(res.statusCode).toBe(200);
    });

    test('scope is OPTIONAL — request without scopes succeeds', async () => {
      const res = await requestDeviceCode();
      expect(res.statusCode).toBe(200);
    });

    test('scope is accepted when provided', async () => {
      const res = await requestDeviceCode({ scopes: ['subnet:1:miner'] });
      expect(res.statusCode).toBe(200);
    });

    test('MUST ignore unrecognized parameters', async () => {
      const res = await requestDeviceCode({ foo: 'bar' });
      expect(res.statusCode).toBe(200);
    });

    test('unknown client_id returns error', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/device/code',
        payload: { client_id: 'nonexistent', client_secret: 'whatever' },
      });
      expect(res.statusCode).toBe(401);
    });

    test('client without device_code grant type is rejected', async () => {
      addTestClient(
        createTestClient({
          client_id: 'no-device-grant',
          client_name: 'No Device',
          grant_types: ['authorization_code'],
        }),
      );
      const res = await app.inject({
        method: 'POST',
        url: '/v1/device/code',
        payload: { client_id: 'no-device-grant', client_secret: TEST_CLIENT_SECRET },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('3.2 Device Authorization Response', () => {
    test('response includes device_code (REQUIRED)', async () => {
      const res = await requestDeviceCode();
      const body = JSON.parse(res.payload);
      expect(body.device_code).toBeDefined();
      expect(typeof body.device_code).toBe('string');
    });

    test('response includes user_code (REQUIRED)', async () => {
      const res = await requestDeviceCode();
      const body = JSON.parse(res.payload);
      expect(body.user_code).toBeDefined();
      expect(typeof body.user_code).toBe('string');
    });

    test('response includes verification_uri (REQUIRED)', async () => {
      const res = await requestDeviceCode();
      const body = JSON.parse(res.payload);
      expect(body.verification_uri).toBeDefined();
      expect(typeof body.verification_uri).toBe('string');
    });

    test('response includes expires_in (REQUIRED) as number', async () => {
      const res = await requestDeviceCode();
      const body = JSON.parse(res.payload);
      expect(body.expires_in).toBeDefined();
      expect(typeof body.expires_in).toBe('number');
      expect(body.expires_in).toBeGreaterThan(0);
    });

    test('response includes interval', async () => {
      const res = await requestDeviceCode();
      const body = JSON.parse(res.payload);
      expect(body.interval).toBeDefined();
      expect(typeof body.interval).toBe('number');
    });

    test('response is JSON with 200 status', async () => {
      const res = await requestDeviceCode();
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    test('user_code format follows XXXX-0000 (no I/O in letters)', async () => {
      const res = await requestDeviceCode();
      const body = JSON.parse(res.payload);
      expect(body.user_code).toMatch(/^[A-HJ-NP-Z]{4}-\d{4}$/);
    });
  });

  describe('3.4 Device Access Token Request', () => {
    test('grant_type MUST be the device_code URN — wrong grant_type fails', async () => {
      const codeRes = await requestDeviceCode();
      const { device_code } = JSON.parse(codeRes.payload);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'client_credentials',
          device_code,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    test('device_code REQUIRED — token request without device_code fails', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    test('client_id REQUIRED for public client at token endpoint', async () => {
      const codeRes = await requestPublicDeviceCode();
      const { device_code } = JSON.parse(codeRes.payload);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code,
        },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    test('confidential client MUST authenticate at token endpoint — missing secret fails', async () => {
      const codeRes = await requestDeviceCode();
      const { device_code } = JSON.parse(codeRes.payload);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code,
          client_id: TEST_CLIENT_ID,
        },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('3.5 Device Access Token Response', () => {
    test('authorization_pending before user approves', async () => {
      const codeRes = await requestDeviceCode();
      const { device_code } = JSON.parse(codeRes.payload);

      const res = await pollToken(device_code);
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).error).toBe('authorization_pending');
    });

    test('access_denied when user denies', async () => {
      const codeRes = await requestDeviceCode();
      const { device_code, user_code } = JSON.parse(codeRes.payload);

      await denyDeviceCode(user_code);

      const res = await pollToken(device_code);
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).error).toBe('access_denied');
    });

    test('expired_token when device code expires', async () => {
      const codeRes = await requestDeviceCode();
      const { device_code } = JSON.parse(codeRes.payload);

      const entry = await getDeviceCode(device_code);
      entry!.expiresAt = new Date(Date.now() - 1000);

      const res = await pollToken(device_code);
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).error).toBe('expired_token');
    });

    test('slow_down on rapid polling', async () => {
      const codeRes = await requestDeviceCode();
      const { device_code } = JSON.parse(codeRes.payload);

      const first = await pollToken(device_code);
      expect(JSON.parse(first.payload).error).toBe('authorization_pending');

      const second = await pollToken(device_code);
      expect(JSON.parse(second.payload).error).toBe('slow_down');
    });

    test('successful token response after full approval flow', async () => {
      const address = await getAliceAddress();
      const codeRes = await requestDeviceCode();
      const { device_code, user_code } = JSON.parse(codeRes.payload);

      const approveRes = await browserPost(app, '/v1/device/approve', { user_code, address });
      expect(approveRes.statusCode).toBe(200);
      const { nonce } = JSON.parse(approveRes.payload);

      const signature = await signWithAlice(nonce);
      const confirmRes = await browserPost(app, '/v1/device/confirm', { user_code, address, nonce, signature });
      expect(confirmRes.statusCode).toBe(200);

      const tokenRes = await pollToken(device_code);
      expect(tokenRes.statusCode).toBe(200);
      const body = JSON.parse(tokenRes.payload);
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeDefined();
      expect(body.token_type).toBe('Bearer');
      expect(body.scope).toBeDefined();
    });

    test('invalid device_code returns non-retryable error', async () => {
      const res = await pollToken('nonexistent-device-code');
      const body = JSON.parse(res.payload);
      expect(body.error).not.toBe('authorization_pending');
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  describe('3.5 Error Response Format', () => {
    test('authorization_pending includes error field', async () => {
      const codeRes = await requestDeviceCode();
      const { device_code } = JSON.parse(codeRes.payload);

      const res = await pollToken(device_code);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('authorization_pending');
    });

    test('slow_down includes error field', async () => {
      const codeRes = await requestDeviceCode();
      const { device_code } = JSON.parse(codeRes.payload);

      await pollToken(device_code);
      const res = await pollToken(device_code);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('slow_down');
    });

    test('access_denied includes error field', async () => {
      const codeRes = await requestDeviceCode();
      const { device_code, user_code } = JSON.parse(codeRes.payload);

      await denyDeviceCode(user_code);

      const res = await pollToken(device_code);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('access_denied');
    });

    test('expired_token includes error field', async () => {
      const codeRes = await requestDeviceCode();
      const { device_code } = JSON.parse(codeRes.payload);

      const entry = await getDeviceCode(device_code);
      entry!.expiresAt = new Date(Date.now() - 1000);

      const res = await pollToken(device_code);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('expired_token');
    });
  });

  describe('5.1 User Code Security', () => {
    test('user codes have sufficient entropy — 10 generations are all unique', async () => {
      const codes = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const res = await requestDeviceCode();
        const body = JSON.parse(res.payload);
        codes.add(body.user_code);
      }
      expect(codes.size).toBe(10);
    });
  });

  describe('6.1 User Code Usability', () => {
    test('user code accepts uppercase input via scopes lookup', async () => {
      const codeRes = await requestDeviceCode();
      const { user_code } = JSON.parse(codeRes.payload);

      const res = await browserGet(app, `/v1/device/scopes?user_code=${user_code.toUpperCase()}`);
      expect(res.statusCode).toBe(200);
    });

    test('user code with canonical format (XXXX-0000) resolves via scopes lookup', async () => {
      const codeRes = await requestDeviceCode();
      const { user_code } = JSON.parse(codeRes.payload);

      const res = await browserGet(app, `/v1/device/scopes?user_code=${user_code}`);
      expect(res.statusCode).toBe(200);
    });
  });

  describe('Flow Binding', () => {
    test('challenge bound to device flow cannot be used in auth flow verify', async () => {
      const address = await getAliceAddress();

      const codeRes = await requestDeviceCode();
      const { user_code } = JSON.parse(codeRes.payload);

      const approveRes = await browserPost(app, '/v1/device/approve', { user_code, address });
      const { nonce } = JSON.parse(approveRes.payload);
      const signature = await signWithAlice(nonce);

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce, address, signature },
      });
      expect(verifyRes.statusCode).toBe(400);
    });

    test('challenge bound to wrong user_code is rejected at confirm', async () => {
      const address = await getAliceAddress();

      const firstRes = await requestDeviceCode();
      const { user_code: firstCode } = JSON.parse(firstRes.payload);

      const secondRes = await requestDeviceCode();
      const { user_code: secondCode } = JSON.parse(secondRes.payload);

      const approveRes = await browserPost(app, '/v1/device/approve', { user_code: firstCode, address });
      const { nonce } = JSON.parse(approveRes.payload);
      const signature = await signWithAlice(nonce);

      const confirmRes = await browserPost(app, '/v1/device/confirm', {
        user_code: secondCode,
        address,
        nonce,
        signature,
      });
      expect(confirmRes.statusCode).toBe(400);
      expect(JSON.parse(confirmRes.payload).message).toContain('user_code mismatch');
    });
  });
});
