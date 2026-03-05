import { cryptoWaitReady } from '@polkadot/util-crypto';
import {
  setupMockDb,
  createTestClient,
  addTestClient,
  clearTestClients,
  clearTestRefreshTokens,
  clearTestChallenges,
  clearTestDeviceCodes,
  TEST_CLIENT_SECRET,
} from '../helpers/mockDb';
import { createMockApi, MockChainBuilder } from '../helpers/mockSubtensor';

// Setup mocks BEFORE other imports
setupMockDb();

const builder = new MockChainBuilder();
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
import { getTestEvmAddress, signWithTestEvmWallet } from '../helpers/evmSign';
import { verifyToken } from '../../crypto/jwt';

const EVM_DEVICE_CLIENT_ID = 'evm-device-client';

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

  addTestClient(
    createTestClient({
      client_id: EVM_DEVICE_CLIENT_ID,
      client_name: 'EVM Device App',
      allowed_sign_methods: ['evm'],
      allowed_scopes: ['openid'],
      grant_types: ['urn:ietf:params:oauth:grant-type:device_code'],
    }),
  );
});

describe('EVM Device Code Routes', () => {
  const evmAddress = getTestEvmAddress();

  async function requestEvmDeviceCode(payload?: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/v1/device/code',
      payload: {
        client_id: EVM_DEVICE_CLIENT_ID,
        client_secret: TEST_CLIENT_SECRET,
        ...payload,
      },
    });
  }

  describe('POST /v1/device/code', () => {
    test('accepts openid scope for EVM client', async () => {
      const res = await requestEvmDeviceCode({ scopes: ['openid'] });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.device_code).toBeDefined();
      expect(body.user_code).toMatch(/^[A-Z]{4}-\d{4}$/);
    });

    test('rejects subnet scope for EVM client', async () => {
      const res = await requestEvmDeviceCode({ scopes: ['subnet:1:miner'] });
      expect(res.statusCode).toBe(400);
    });

    test('accepts empty scopes for EVM client', async () => {
      const res = await requestEvmDeviceCode();
      expect(res.statusCode).toBe(200);
    });
  });

  describe('POST /v1/device/approve', () => {
    test('rejects sr25519 address for EVM client', async () => {
      const codeRes = await requestEvmDeviceCode();
      const { user_code } = JSON.parse(codeRes.payload);

      const approveRes = await browserPost(app, '/v1/device/approve', {
        user_code,
        address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
      });
      expect(approveRes.statusCode).toBe(400);
      const body = JSON.parse(approveRes.payload);
      expect(body.message).toContain('evm');
    });

    test('accepts EVM address for EVM client', async () => {
      const codeRes = await requestEvmDeviceCode();
      const { user_code } = JSON.parse(codeRes.payload);

      const approveRes = await browserPost(app, '/v1/device/approve', { user_code, address: evmAddress });
      expect(approveRes.statusCode).toBe(200);
      const body = JSON.parse(approveRes.payload);
      expect(body.nonce).toMatch(/^taostats-auth:/);
    });
  });

  describe('POST /v1/device/confirm', () => {
    test('rejects sr25519 address at confirm step', async () => {
      const codeRes = await requestEvmDeviceCode();
      const { user_code } = JSON.parse(codeRes.payload);

      // Approve with EVM address
      const approveRes = await browserPost(app, '/v1/device/approve', { user_code, address: evmAddress });
      const { nonce } = JSON.parse(approveRes.payload);

      // Attempt confirm with sr25519 address
      const confirmRes = await browserPost(app, '/v1/device/confirm', {
        user_code,
        address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
        nonce,
        signature: '0x' + '00'.repeat(64),
      });
      expect(confirmRes.statusCode).toBe(400);
    });
  });

  describe('full device code flow (EVM)', () => {
    test('request -> approve -> confirm -> poll -> tokens', async () => {
      // 1. Request device code
      const codeRes = await requestEvmDeviceCode({ scopes: ['openid'] });
      const { device_code, user_code } = JSON.parse(codeRes.payload);

      // 2. Approve
      const approveRes = await browserPost(app, '/v1/device/approve', { user_code, address: evmAddress });
      expect(approveRes.statusCode).toBe(200);
      const { nonce } = JSON.parse(approveRes.payload);

      // 3. Sign and confirm
      const signature = await signWithTestEvmWallet(nonce);
      const confirmRes = await browserPost(app, '/v1/device/confirm', {
        user_code,
        address: evmAddress,
        nonce,
        signature,
      });
      expect(confirmRes.statusCode).toBe(200);

      // 4. Poll for tokens
      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: EVM_DEVICE_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(tokenRes.statusCode).toBe(200);
      const body = JSON.parse(tokenRes.payload);
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeDefined();
      expect(body.id_token).toBeDefined();
      expect(body.scope).toBe('openid');

      // Verify JWT claims
      const claims = verifyToken(body.access_token);
      expect(claims.sub).toBe(evmAddress);
      expect(claims.evm_address).toBe(evmAddress);
      expect(claims.hotkey).toBeNull();
      expect(claims.coldkey).toBeNull();
    });

    test('scopeless EVM device code flow', async () => {
      // 1. Request device code (no scopes)
      const codeRes = await requestEvmDeviceCode();
      const { device_code, user_code } = JSON.parse(codeRes.payload);

      // 2. Approve
      const approveRes = await browserPost(app, '/v1/device/approve', { user_code, address: evmAddress });
      const { nonce } = JSON.parse(approveRes.payload);

      // 3. Sign and confirm
      const signature = await signWithTestEvmWallet(nonce);
      await browserPost(app, '/v1/device/confirm', { user_code, address: evmAddress, nonce, signature });

      // 4. Poll for tokens
      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: EVM_DEVICE_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(tokenRes.statusCode).toBe(200);
      const body = JSON.parse(tokenRes.payload);
      expect(body.access_token).toBeDefined();

      const claims = verifyToken(body.access_token);
      expect(claims.evm_address).toBe(evmAddress);
    });
  });

  describe('GET /v1/device/scopes', () => {
    test('returns sign_method for EVM client', async () => {
      const codeRes = await requestEvmDeviceCode({ scopes: ['openid'] });
      const { user_code } = JSON.parse(codeRes.payload);

      const scopesRes = await browserGet(app, `/v1/device/scopes?user_code=${user_code}`);
      expect(scopesRes.statusCode).toBe(200);
      const body = JSON.parse(scopesRes.payload);
      expect(body.sign_method).toBe('evm');
      expect(body.scopes).toEqual(['openid']);
    });
  });
});
