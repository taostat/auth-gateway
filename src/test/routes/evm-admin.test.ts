import { setupMockDb, clearTestClients, addTestClient } from '../helpers/mockDb';
import { randomUUID } from 'node:crypto';

// Setup mocks BEFORE imports
setupMockDb();

// Override createClient mock to return a proper response
const { createClient: mockCreateClient } = jest.requireMock('../../db/clients') as {
  createClient: jest.Mock;
};
mockCreateClient.mockImplementation(async (opts: Record<string, unknown>) => {
  const client = {
    client_id: randomUUID(),
    client_name: opts.client_name,
    client_type: opts.client_type,
    redirect_uris: opts.redirect_uris ?? [],
    grant_types: opts.grant_types ?? [],
    allowed_scopes: opts.allowed_scopes ?? [],
    allowed_origins: opts.allowed_origins ?? [],
    allowed_sign_methods: opts.allowed_sign_methods ?? ['sr25519'],
    rate_limit: opts.rate_limit ?? 60,
    active: true,
    created_at: new Date(),
    updated_at: new Date(),
  };
  addTestClient(client);
  return { client, client_secret: opts.client_type === 'confidential' ? 'generated-secret' : undefined };
});

process.env.ADMIN_API_KEY = 'test-admin-key';

jest.mock('../../subtensor/client', () => ({
  getSubtensorApi: jest.fn(),
  disconnectSubtensor: jest.fn().mockResolvedValue(undefined),
  isSubtensorConnected: jest.fn().mockReturnValue(true),
}));

import { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers/app';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  clearTestClients();
});

describe('EVM Admin Routes', () => {
  const adminHeaders = { 'x-admin-api-key': 'test-admin-key' };

  describe('POST /v1/admin/clients (EVM)', () => {
    test('creates EVM client with openid scope', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/clients',
        headers: adminHeaders,
        payload: {
          client_name: 'EVM App',
          client_type: 'public',
          redirect_uris: ['http://localhost:3001/callback'],
          grant_types: ['authorization_code'],
          allowed_scopes: ['openid'],
          allowed_origins: ['http://localhost:3001'],
          allowed_sign_methods: ['evm'],
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.allowed_sign_methods).toEqual(['evm']);
    });

    test('rejects EVM client with subnet scopes', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/clients',
        headers: adminHeaders,
        payload: {
          client_name: 'Bad EVM App',
          client_type: 'public',
          redirect_uris: ['http://localhost:3001/callback'],
          grant_types: ['authorization_code'],
          allowed_scopes: ['subnet:1:miner'],
          allowed_origins: ['http://localhost:3001'],
          allowed_sign_methods: ['evm'],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    test('rejects multiple sign methods', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/clients',
        headers: adminHeaders,
        payload: {
          client_name: 'Multi Method App',
          client_type: 'public',
          redirect_uris: ['http://localhost:3001/callback'],
          grant_types: ['authorization_code'],
          allowed_scopes: [],
          allowed_origins: ['http://localhost:3001'],
          allowed_sign_methods: ['sr25519', 'evm'],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    test('defaults to sr25519 when sign method omitted', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/clients',
        headers: adminHeaders,
        payload: {
          client_name: 'Default App',
          client_type: 'public',
          redirect_uris: ['http://localhost:3001/callback'],
          grant_types: ['authorization_code'],
          allowed_scopes: [],
          allowed_origins: ['http://localhost:3001'],
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.allowed_sign_methods).toEqual(['sr25519']);
    });
  });
});
