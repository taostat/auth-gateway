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
});
