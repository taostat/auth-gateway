import {
  setupMockDb,
  createTestClient,
  addTestClient,
  clearTestClients,
  addTestOAuthEvent,
  clearTestOAuthEvents,
} from '../helpers/mockDb';

setupMockDb();

process.env.ADMIN_API_KEY = 'test-admin-key';

jest.mock('../../subtensor/client', () => ({
  getSubtensorApi: jest.fn(),
  disconnectSubtensor: jest.fn().mockResolvedValue(undefined),
  isSubtensorConnected: jest.fn().mockReturnValue(true),
}));

import { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers/app';

const ADMIN_HEADER = { 'x-admin-api-key': 'test-admin-key' };

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  clearTestClients();
  clearTestOAuthEvents();
});

describe('GET /v1/admin/stats/overview', () => {
  test('returns empty arrays when no clients exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/stats/overview',
      headers: ADMIN_HEADER,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.totals).toEqual({ exchanges: 0, successes: 0, failures: 0, distinct_users: 0 });
    expect(body.by_client).toEqual([]);
  });

  test('distinct_users counts each wallet once across multiple clients', async () => {
    addTestClient(createTestClient({ client_id: 'client-a' }));
    addTestClient(createTestClient({ client_id: 'client-b' }));

    const sharedWallet = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
    addTestOAuthEvent({
      client_id: 'client-a',
      event_type: 'token_exchange',
      outcome: 'success',
      subject: sharedWallet,
    });
    addTestOAuthEvent({
      client_id: 'client-b',
      event_type: 'token_exchange',
      outcome: 'success',
      subject: sharedWallet,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/stats/overview?window=7d',
      headers: ADMIN_HEADER,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    // Per-client: each sees 1 distinct user
    const clientA = body.by_client.find((c: { client_id: string }) => c.client_id === 'client-a');
    const clientB = body.by_client.find((c: { client_id: string }) => c.client_id === 'client-b');
    expect(clientA.distinct_users).toBe(1);
    expect(clientB.distinct_users).toBe(1);

    // Overview total: same wallet across two clients should count as 1
    expect(body.totals.distinct_users).toBe(1);
  });

  test('sorts by_client by exchanges descending', async () => {
    addTestClient(createTestClient({ client_id: 'a' }));
    addTestClient(createTestClient({ client_id: 'b' }));
    addTestClient(createTestClient({ client_id: 'c' }));

    addTestOAuthEvent({ client_id: 'a', event_type: 'token_exchange', outcome: 'success' });
    for (let i = 0; i < 3; i++) {
      addTestOAuthEvent({ client_id: 'b', event_type: 'token_exchange', outcome: 'success' });
    }
    for (let i = 0; i < 2; i++) {
      addTestOAuthEvent({ client_id: 'c', event_type: 'token_exchange', outcome: 'failure' });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/stats/overview?window=7d',
      headers: ADMIN_HEADER,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.by_client.map((c: { client_id: string }) => c.client_id)).toEqual(['b', 'c', 'a']);
    expect(body.totals.exchanges).toBe(6);
    expect(body.totals.successes).toBe(4);
    expect(body.totals.failures).toBe(2);
  });
});
