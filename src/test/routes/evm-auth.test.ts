import { cryptoWaitReady } from '@polkadot/util-crypto';
import { setupMockDb, clearTestChallenges } from '../helpers/mockDb';

// Setup mocks BEFORE other imports
setupMockDb();

jest.mock('../../subtensor/client', () => ({
  getSubtensorApi: jest.fn(),
  disconnectSubtensor: jest.fn().mockResolvedValue(undefined),
  isSubtensorConnected: jest.fn().mockReturnValue(true),
}));

import { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers/app';
import { getTestEvmAddress, signWithTestEvmWallet } from '../helpers/evmSign';
import { verifyToken } from '../../crypto/jwt';

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

describe('EVM Auth Routes', () => {
  const evmAddress = getTestEvmAddress();

  describe('POST /v1/auth/challenge', () => {
    test('returns nonce for valid EVM address', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address: evmAddress },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.nonce).toMatch(/^taostats-auth:/);
      expect(body.expires_in).toBeGreaterThan(0);
    });

    test('accepts lowercase EVM address', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address: evmAddress.toLowerCase() },
      });
      expect(res.statusCode).toBe(200);
    });

    test('accepts openid scope for EVM address', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address: evmAddress, scopes: ['openid'] },
      });
      expect(res.statusCode).toBe(200);
    });

    test('rejects subnet scope for EVM address', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address: evmAddress, scopes: ['subnet:1:miner'] },
      });
      expect(res.statusCode).toBe(400);
    });

    test('rejects tao:holder scope for EVM address', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address: evmAddress, scopes: ['tao:holder'] },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /v1/auth/verify', () => {
    test('full EVM challenge -> sign -> verify flow', async () => {
      // Get challenge
      const challengeRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address: evmAddress },
      });
      const { nonce } = JSON.parse(challengeRes.payload);

      // Sign with EVM wallet
      const signature = await signWithTestEvmWallet(nonce);

      // Verify
      const verifyRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce, address: evmAddress, signature },
      });
      expect(verifyRes.statusCode).toBe(200);
      const body = JSON.parse(verifyRes.payload);
      expect(body.access_token).toBeDefined();
      expect(body.token_type).toBe('Bearer');
      expect(body.expires_in).toBeGreaterThan(0);

      // Verify JWT claims
      const claims = verifyToken(body.access_token);
      expect(claims.sub).toBe(evmAddress);
      expect(claims.evm_address).toBe(evmAddress);
      expect(claims.hotkey).toBeNull();
      expect(claims.coldkey).toBeNull();
    });

    test('EVM flow with openid scope', async () => {
      const challengeRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address: evmAddress, scopes: ['openid'] },
      });
      const { nonce } = JSON.parse(challengeRes.payload);
      const signature = await signWithTestEvmWallet(nonce);

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce, address: evmAddress, signature },
      });
      expect(verifyRes.statusCode).toBe(200);
      const body = JSON.parse(verifyRes.payload);
      expect(body.scope).toBe('openid');
    });

    test('rejects invalid EVM signature', async () => {
      const challengeRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address: evmAddress },
      });
      const { nonce } = JSON.parse(challengeRes.payload);

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce, address: evmAddress, signature: '0x' + '00'.repeat(65) },
      });
      expect(verifyRes.statusCode).toBe(401);
    });

    test('normalizes lowercase EVM address to checksum', async () => {
      const lower = evmAddress.toLowerCase();

      const challengeRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address: lower },
      });
      const { nonce } = JSON.parse(challengeRes.payload);
      const signature = await signWithTestEvmWallet(nonce);

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce, address: lower, signature },
      });
      expect(verifyRes.statusCode).toBe(200);

      // JWT sub should be checksummed
      const body = JSON.parse(verifyRes.payload);
      const claims = verifyToken(body.access_token);
      expect(claims.sub).toBe(evmAddress);
      expect(claims.evm_address).toBe(evmAddress);
    });
  });
});
