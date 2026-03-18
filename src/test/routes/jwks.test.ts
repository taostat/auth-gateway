import { cryptoWaitReady } from '@polkadot/util-crypto';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createMockApi, MockChainBuilder } from '../helpers/mockSubtensor';
import { getPrivateKey } from '../../crypto/keys';

const mockApi = createMockApi(new MockChainBuilder().getState());

jest.mock('../../subtensor/client', () => ({
  getSubtensorApi: jest.fn().mockResolvedValue(mockApi),
  disconnectSubtensor: jest.fn().mockResolvedValue(undefined),
  isSubtensorConnected: jest.fn().mockReturnValue(true),
}));

import { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers/app';

let app: FastifyInstance;

beforeAll(async () => {
  await cryptoWaitReady();
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

describe('JWKS Route', () => {
  test('GET /.well-known/jwks.json returns JWKS', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/jwks.json',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.keys).toBeDefined();
    expect(body.keys).toHaveLength(1);

    const key = body.keys[0];
    expect(key.kty).toBe('RSA');
    expect(key.use).toBe('sig');
    expect(key.alg).toBe('RS256');
    expect(key.kid).toBeDefined();
    expect(key.n).toBeDefined();
    expect(key.e).toBeDefined();
  });

  test('JWKS public key can verify a JWT issued by the gateway', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/jwks.json',
    });
    const body = JSON.parse(res.payload);
    const jwk = body.keys[0];

    // Convert JWK back to PEM
    const pubKeyObj = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const pem = pubKeyObj.export({ format: 'pem', type: 'spki' });

    // Create a token using the gateway's signing key
    const token = jwt.sign({ sub: 'test', scopes: [], type: 'access' }, getPrivateKey(), {
      algorithm: 'RS256',
      issuer: 'https://auth.taostats.io',
      audience: 'bittensor-apps',
      expiresIn: 900,
    });

    // Verify the token using the JWKS public key
    const decoded = jwt.verify(token, pem as string, {
      algorithms: ['RS256'],
      issuer: 'https://auth.taostats.io',
      audience: 'bittensor-apps',
    });
    expect((decoded as any).sub).toBe('test');
  });

  test('JWKS response has cache-control header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/jwks.json',
    });
    expect(res.headers['cache-control']).toContain('public');
    expect(res.headers['cache-control']).toContain('max-age=3600');
  });
});
