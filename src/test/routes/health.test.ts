import { setupMockDb, createTestClient, addTestClient, clearTestClients } from '../helpers/mockDb';

setupMockDb();


jest.mock('../../subtensor/client', () => ({
  getSubtensorApi: jest.fn(),
  disconnectSubtensor: jest.fn().mockResolvedValue(undefined),
  isSubtensorConnected: jest.fn(),
}));

import { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers/app';
import { getPool } from '../../db/pool';
import { isSubtensorConnected } from '../../subtensor/client';

let app: FastifyInstance;

beforeAll(async () => {
  clearTestClients();
  addTestClient(createTestClient());
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

describe('Health Route', () => {
  test('returns 200 when all dependencies are healthy', async () => {
    (isSubtensorConnected as jest.Mock).mockReturnValue(true);
    (getPool as jest.Mock).mockReturnValue({
      query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('ok');
    expect(body.database).toBe(true);
    expect(body.subtensor).toBe(true);
  });

  test('returns 503 when degraded', async () => {
    (isSubtensorConnected as jest.Mock).mockReturnValue(false);
    (getPool as jest.Mock).mockReturnValue({
      query: jest.fn().mockRejectedValue(new Error('db down')),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('degraded');
    expect(body.database).toBe(false);
    expect(body.subtensor).toBe(false);
  });
});
