import { cryptoWaitReady } from '@polkadot/util-crypto';
import { setupMockDb, clearTestChallenges } from '../helpers/mockDb';
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

import { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers/app';
import { getAliceAddress, signWithAlice } from '../helpers/sign';
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
});

describe('Auth Routes', () => {
  describe('POST /v1/auth/challenge', () => {
    test('returns nonce for valid address', async () => {
      const address = await getAliceAddress();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.nonce).toMatch(/^bittensor-auth:/);
      expect(body.expires_in).toBeGreaterThan(0);
    });

    test('returns 400 for invalid SS58 address', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address: 'not-a-valid-address' },
      });
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 for invalid scope format', async () => {
      const address = await getAliceAddress();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address, scopes: ['invalid-scope'] },
      });
      expect(res.statusCode).toBe(400);
    });

    test('accepts valid scopes', async () => {
      const address = await getAliceAddress();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address, scopes: ['subnet:1:miner'] },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('POST /v1/auth/verify', () => {
    test('full challenge -> sign -> verify flow (scopeless)', async () => {
      const address = await getAliceAddress();

      // Get challenge
      const challengeRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address },
      });
      const { nonce } = JSON.parse(challengeRes.payload);

      // Sign nonce
      const signature = await signWithAlice(nonce);

      // Verify
      const verifyRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce, address, signature },
      });
      expect(verifyRes.statusCode).toBe(200);
      const body = JSON.parse(verifyRes.payload);
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeUndefined();
      expect(body.token_type).toBe('Bearer');
      expect(body.expires_in).toBeGreaterThan(0);
    });

    test('full flow with scopes (miner)', async () => {
      const address = await getAliceAddress();

      const challengeRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address, scopes: ['subnet:1:miner'] },
      });
      const { nonce } = JSON.parse(challengeRes.payload);
      const signature = await signWithAlice(nonce);

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce, address, signature },
      });
      expect(verifyRes.statusCode).toBe(200);
      const body = JSON.parse(verifyRes.payload);
      expect(body.scopes).toEqual(['subnet:1:miner']);
    });

    test('returns 401 for invalid signature', async () => {
      const address = await getAliceAddress();

      const challengeRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address },
      });
      const { nonce } = JSON.parse(challengeRes.payload);

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce, address, signature: '0x' + '00'.repeat(64) },
      });
      expect(verifyRes.statusCode).toBe(401);
    });

    test('returns 401 for expired/missing challenge (replay)', async () => {
      const address = await getAliceAddress();

      const challengeRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address },
      });
      const { nonce } = JSON.parse(challengeRes.payload);
      const signature = await signWithAlice(nonce);

      // First verify succeeds
      await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce, address, signature },
      });

      // Replay attack — reuse same nonce
      const replayRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce, address, signature },
      });
      expect(replayRes.statusCode).toBe(401);
    });
  });
});
