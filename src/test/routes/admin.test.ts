import { setupMockDb, createTestClient, addTestClient, clearTestClients } from '../helpers/mockDb';

// Setup mocks BEFORE imports
setupMockDb();

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
  addTestClient(createTestClient());
});

describe('Admin Routes', () => {
  describe('GET /v1/admin/clients', () => {
    test('returns 401 without admin API key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/clients',
      });
      expect(res.statusCode).toBe(401);
    });

    test('returns 401 with wrong admin API key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/clients',
        headers: { 'x-admin-api-key': 'wrong-key' },
      });
      expect(res.statusCode).toBe(401);
    });

    test('returns client list with valid admin key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/clients',
        headers: { 'x-admin-api-key': 'test-admin-key' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(1);
      expect(body[0].client_id).toBe('test-client-id');
    });
  });

  describe('DELETE /v1/admin/clients/:client_id', () => {
    test('deactivates existing client', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/admin/clients/test-client-id',
        headers: { 'x-admin-api-key': 'test-admin-key' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe('deactivated');
    });

    test('returns 404 for nonexistent client', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/admin/clients/nonexistent',
        headers: { 'x-admin-api-key': 'test-admin-key' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH /v1/admin/clients/:client_id', () => {
    test('returns 401 without admin API key', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/admin/clients/test-client-id',
        payload: { client_name: 'Updated' },
      });
      expect(res.statusCode).toBe(401);
    });

    test('updates client name', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/admin/clients/test-client-id',
        headers: { 'x-admin-api-key': 'test-admin-key' },
        payload: { client_name: 'Updated App' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.client_name).toBe('Updated App');
      expect(body.client_id).toBe('test-client-id');
    });

    test('updates redirect_uris', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/admin/clients/test-client-id',
        headers: { 'x-admin-api-key': 'test-admin-key' },
        payload: { redirect_uris: ['http://localhost:4000/callback'] },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.redirect_uris).toEqual(['http://localhost:4000/callback']);
    });

    test('updates allowed_scopes', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/admin/clients/test-client-id',
        headers: { 'x-admin-api-key': 'test-admin-key' },
        payload: { allowed_scopes: ['subnet:1:miner', 'openid'] },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.allowed_scopes).toEqual(['subnet:1:miner', 'openid']);
    });

    test('rejects invalid scope format', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/admin/clients/test-client-id',
        headers: { 'x-admin-api-key': 'test-admin-key' },
        payload: { allowed_scopes: ['invalid-scope'] },
      });
      expect(res.statusCode).toBe(400);
    });

    test('rejects invalid redirect_uri with fragment', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/admin/clients/test-client-id',
        headers: { 'x-admin-api-key': 'test-admin-key' },
        payload: { redirect_uris: ['http://localhost:3000/callback#bad'] },
      });
      expect(res.statusCode).toBe(400);
    });

    test('rejects clearing redirect_uris when auth_code grant is active', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/admin/clients/test-client-id',
        headers: { 'x-admin-api-key': 'test-admin-key' },
        payload: { redirect_uris: [] },
      });
      expect(res.statusCode).toBe(400);
    });

    test('rejects non-openid scopes for EVM client', async () => {
      clearTestClients();
      addTestClient(createTestClient({
        client_id: 'evm-client',
        allowed_sign_methods: ['evm'],
        allowed_scopes: ['openid'],
      }));

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/admin/clients/evm-client',
        headers: { 'x-admin-api-key': 'test-admin-key' },
        payload: { allowed_scopes: ['subnet:1:miner'] },
      });
      expect(res.statusCode).toBe(400);
    });

    test('returns 404 for nonexistent client', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/admin/clients/nonexistent',
        headers: { 'x-admin-api-key': 'test-admin-key' },
        payload: { client_name: 'Updated' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /v1/admin/clients/:client_id/rotate-secret', () => {
    test('returns 401 without admin API key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/clients/test-client-id/rotate-secret',
      });
      expect(res.statusCode).toBe(401);
    });

    test('rotates secret for confidential client', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/clients/test-client-id/rotate-secret',
        headers: { 'x-admin-api-key': 'test-admin-key' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.client_id).toBe('test-client-id');
      expect(body.client_secret).toBeDefined();
      expect(body.message).toContain('rotated');
    });

    test('returns 404 for public client', async () => {
      clearTestClients();
      addTestClient(createTestClient({
        client_id: 'public-client',
        client_type: 'public',
        client_secret_hash: undefined,
      }));

      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/clients/public-client/rotate-secret',
        headers: { 'x-admin-api-key': 'test-admin-key' },
      });
      expect(res.statusCode).toBe(404);
    });

    test('returns 404 for nonexistent client', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/clients/nonexistent/rotate-secret',
        headers: { 'x-admin-api-key': 'test-admin-key' },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
