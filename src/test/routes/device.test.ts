import { cryptoWaitReady } from '@polkadot/util-crypto';
import {
  setupMockDb,
  createTestClient,
  addTestClient,
  clearTestClients,
  clearTestRefreshTokens,
  clearTestChallenges,
  clearTestDeviceCodes,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
} from '../helpers/mockDb';
import { createMockApi, MockChainBuilder } from '../helpers/mockSubtensor';

// Setup mocks BEFORE other imports
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

// Mock getCurrentEpoch
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
import { buildTestApp } from '../helpers/app';
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
});

describe('Device Code Routes', () => {
  describe('POST /v1/device/code', () => {
    test('returns device code and user code with valid client_id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/device/code',
        payload: { client_id: TEST_CLIENT_ID },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.device_code).toBeDefined();
      expect(body.user_code).toMatch(/^[A-Z]{4}-\d{4}$/);
      expect(body.verification_uri).toBeDefined();
      expect(body.expires_in).toBeGreaterThan(0);
      expect(body.interval).toBeGreaterThan(0);
    });

    test('returns 400 without client_id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/device/code',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    test('returns 401 for unknown client_id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/device/code',
        payload: { client_id: 'nonexistent' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /v1/oauth/token (device_code)', () => {
    test('returns authorization_pending before approval', async () => {
      const codeRes = await app.inject({
        method: 'POST',
        url: '/v1/device/code',
        payload: { client_id: TEST_CLIENT_ID },
      });
      const { device_code } = JSON.parse(codeRes.payload);

      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(tokenRes.statusCode).toBe(400);
      const body = JSON.parse(tokenRes.payload);
      expect(body.error).toBe('authorization_pending');
    });

    test('returns 404 for invalid device code', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          device_code: 'nonexistent',
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(res.statusCode).toBe(404);
    });

    test('returns expired_token when device code has expired', async () => {
      const codeRes = await app.inject({
        method: 'POST',
        url: '/v1/device/code',
        payload: { client_id: TEST_CLIENT_ID },
      });
      const { device_code } = JSON.parse(codeRes.payload);

      // Mutate the stored entry to expire it
      const entry = await getDeviceCode(device_code);
      entry!.expiresAt = new Date(Date.now() - 1000);

      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(tokenRes.statusCode).toBe(400);
      const body = JSON.parse(tokenRes.payload);
      expect(body.error).toBe('expired_token');
    });

    test('returns access_denied when device code is denied', async () => {
      const codeRes = await app.inject({
        method: 'POST',
        url: '/v1/device/code',
        payload: { client_id: TEST_CLIENT_ID },
      });
      const { device_code, user_code } = JSON.parse(codeRes.payload);

      await denyDeviceCode(user_code);

      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(tokenRes.statusCode).toBe(400);
      const body = JSON.parse(tokenRes.payload);
      expect(body.error).toBe('access_denied');
    });
  });

  describe('Full device code flow', () => {
    test('request code -> approve -> poll -> get tokens (with client auth)', async () => {
      const address = await getAliceAddress();

      // Step 1: Request device code
      const codeRes = await app.inject({
        method: 'POST',
        url: '/v1/device/code',
        payload: { client_id: TEST_CLIENT_ID },
      });
      const { device_code, user_code } = JSON.parse(codeRes.payload);

      // Step 2: Poll — should be pending
      const pendingRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(pendingRes.statusCode).toBe(400);

      // Step 3: Approve — get challenge nonce
      const approveRes = await app.inject({
        method: 'POST',
        url: '/v1/device/approve',
        payload: { user_code, address },
      });
      expect(approveRes.statusCode).toBe(200);
      const { nonce } = JSON.parse(approveRes.payload);

      // Step 4: Sign and confirm
      const signature = await signWithAlice(nonce);
      const confirmRes = await app.inject({
        method: 'POST',
        url: '/v1/device/confirm',
        payload: { user_code, address, nonce, signature },
      });
      expect(confirmRes.statusCode).toBe(200);

      // Step 5: Poll again — should get tokens
      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(tokenRes.statusCode).toBe(200);
      const body = JSON.parse(tokenRes.payload);
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeDefined();
      expect(body.token_type).toBe('Bearer');
      expect(body.scope).toBeDefined();
    });

    test('rejects polling with wrong client_id', async () => {
      // Create another client
      addTestClient(
        createTestClient({
          client_id: 'other-client',
          client_name: 'Other',
          client_type: 'public',
          grant_types: ['urn:ietf:params:oauth:grant-type:device_code'],
        }),
      );

      const codeRes = await app.inject({
        method: 'POST',
        url: '/v1/device/code',
        payload: { client_id: TEST_CLIENT_ID },
      });
      const { device_code } = JSON.parse(codeRes.payload);

      // Try polling with different client
      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: 'other-client',
        },
      });
      expect(tokenRes.statusCode).toBe(401);
    });
  });

  describe('polling rate limit', () => {
    test('returns slow_down when polling too frequently', async () => {
      const codeRes = await app.inject({
        method: 'POST',
        url: '/v1/device/code',
        payload: { client_id: TEST_CLIENT_ID },
      });
      const { device_code } = JSON.parse(codeRes.payload);

      // First poll — authorization_pending (sets lastPolledAt)
      const firstPoll = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(firstPoll.statusCode).toBe(400);
      expect(JSON.parse(firstPoll.payload).error).toBe('authorization_pending');

      // Second poll immediately — should get slow_down
      const secondPoll = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(secondPoll.statusCode).toBe(400);
      expect(JSON.parse(secondPoll.payload).error).toBe('slow_down');
    });
  });

  describe('allowed_scopes enforcement', () => {
    test('rejects scopes not in client allowed_scopes', async () => {
      addTestClient(
        createTestClient({
          client_id: 'restricted-device',
          client_name: 'Restricted Device',
          allowed_scopes: ['subnet:1:miner'],
          grant_types: ['urn:ietf:params:oauth:grant-type:device_code'],
        }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/v1/device/code',
        payload: { client_id: 'restricted-device', scopes: ['subnet:1:validator'] },
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.message).toContain('not allowed');
    });

    test('allows scopes within client allowed_scopes', async () => {
      addTestClient(
        createTestClient({
          client_id: 'restricted-device-2',
          client_name: 'Restricted Device 2',
          allowed_scopes: ['subnet:1:miner'],
          grant_types: ['urn:ietf:params:oauth:grant-type:device_code'],
        }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/v1/device/code',
        payload: { client_id: 'restricted-device-2', scopes: ['subnet:1:miner'] },
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
