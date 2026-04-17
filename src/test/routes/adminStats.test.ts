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
  addTestClient(createTestClient());
});

describe('GET /v1/admin/clients/:client_id/stats', () => {
  test('returns 401 without admin API key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/clients/test-client-id/stats',
    });
    expect(res.statusCode).toBe(401);
  });

  test('returns 404 for unknown client', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/clients/nonexistent/stats',
      headers: ADMIN_HEADER,
    });
    expect(res.statusCode).toBe(404);
  });

  test('returns zeros and empty arrays with no events', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/clients/test-client-id/stats?window=24h',
      headers: ADMIN_HEADER,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.window).toBe('24h');
    expect(body.totals).toEqual({
      exchanges: 0,
      successes: 0,
      failures: 0,
      distinct_users: 0,
      success_rate: 0,
    });
    expect(body.failures_by_reason).toEqual({});
    expect(body.scopes_requested).toEqual([]);
    expect(body.timeseries).toEqual([]);
  });

  test('aggregates successes, failures, distinct users, and success_rate', async () => {
    addTestOAuthEvent({
      client_id: 'test-client-id',
      event_type: 'token_exchange',
      outcome: 'success',
      subject: 'alice',
    });
    addTestOAuthEvent({
      client_id: 'test-client-id',
      event_type: 'token_exchange',
      outcome: 'success',
      subject: 'alice',
    });
    addTestOAuthEvent({
      client_id: 'test-client-id',
      event_type: 'token_refresh',
      outcome: 'success',
      subject: 'bob',
    });
    addTestOAuthEvent({
      client_id: 'test-client-id',
      event_type: 'token_exchange',
      outcome: 'failure',
      error_reason: 'invalid_grant',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/clients/test-client-id/stats?window=24h',
      headers: ADMIN_HEADER,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.totals.exchanges).toBe(4);
    expect(body.totals.successes).toBe(3);
    expect(body.totals.failures).toBe(1);
    expect(body.totals.distinct_users).toBe(2);
    expect(body.totals.success_rate).toBeCloseTo(0.75);
    expect(body.failures_by_reason).toEqual({ invalid_grant: 1 });
  });

  test('scopes_requested aggregates across authorize successes', async () => {
    addTestOAuthEvent({
      client_id: 'test-client-id',
      event_type: 'authorize',
      outcome: 'success',
      scopes: ['openid', 'subnet:1:miner'],
    });
    addTestOAuthEvent({
      client_id: 'test-client-id',
      event_type: 'authorize',
      outcome: 'success',
      scopes: ['openid'],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/clients/test-client-id/stats?window=7d',
      headers: ADMIN_HEADER,
    });
    const body = JSON.parse(res.payload);
    const scopeCounts = new Map(
      body.scopes_requested.map((s: { scope: string; count: number }) => [s.scope, s.count]),
    );
    expect(scopeCounts.get('openid')).toBe(2);
    expect(scopeCounts.get('subnet:1:miner')).toBe(1);
  });

  test('30d window produces daily timeseries buckets', async () => {
    const day1 = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const day2 = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    addTestOAuthEvent({
      client_id: 'test-client-id',
      event_type: 'token_exchange',
      outcome: 'success',
      occurred_at: day1,
    });
    addTestOAuthEvent({
      client_id: 'test-client-id',
      event_type: 'token_exchange',
      outcome: 'success',
      occurred_at: day2,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/clients/test-client-id/stats?window=30d',
      headers: ADMIN_HEADER,
    });
    const body = JSON.parse(res.payload);
    expect(body.timeseries.length).toBe(2);
    const zero = body.timeseries[0];
    const one = body.timeseries[1];
    expect(new Date(one.bucket).getTime()).toBeGreaterThan(new Date(zero.bucket).getTime());
  });
});
