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

describe('GET /v1/admin/clients/:client_id/events', () => {
  test('returns 404 for unknown client', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/clients/nonexistent/events',
      headers: ADMIN_HEADER,
    });
    expect(res.statusCode).toBe(404);
  });

  test('returns events ordered by occurred_at DESC with subject_prefix', async () => {
    const t0 = new Date(Date.now() - 1000);
    const t1 = new Date(Date.now() - 500);
    addTestOAuthEvent({
      client_id: 'test-client-id',
      event_type: 'authorize',
      outcome: 'success',
      subject: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
      occurred_at: t0,
    });
    addTestOAuthEvent({
      client_id: 'test-client-id',
      event_type: 'token_exchange',
      outcome: 'success',
      occurred_at: t1,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/clients/test-client-id/events',
      headers: ADMIN_HEADER,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.events).toHaveLength(2);
    expect(body.events[0].event_type).toBe('token_exchange');
    expect(body.events[1].event_type).toBe('authorize');
    expect(body.events[1].subject_prefix).toHaveLength(16);
    expect(body.events[0].subject_prefix).toBeNull();
    expect(body.has_more).toBe(false);
    expect(body.next_cursor).toBeNull();
  });

  test('pagination cursor does not skip events sharing a timestamp', async () => {
    const shared = new Date(Date.now() - 1000);
    for (let i = 0; i < 3; i++) {
      addTestOAuthEvent({
        client_id: 'test-client-id',
        event_type: 'token_exchange',
        outcome: 'success',
        occurred_at: shared,
      });
    }

    const firstPage = await app.inject({
      method: 'GET',
      url: '/v1/admin/clients/test-client-id/events?limit=1',
      headers: ADMIN_HEADER,
    });
    const firstBody = JSON.parse(firstPage.payload);
    expect(firstBody.events).toHaveLength(1);
    expect(firstBody.has_more).toBe(true);

    const secondPage = await app.inject({
      method: 'GET',
      url: `/v1/admin/clients/test-client-id/events?limit=1&before=${encodeURIComponent(firstBody.next_cursor)}`,
      headers: ADMIN_HEADER,
    });
    const secondBody = JSON.parse(secondPage.payload);
    expect(secondBody.events).toHaveLength(1);
    expect(secondBody.events[0].id).not.toBe(firstBody.events[0].id);

    const thirdPage = await app.inject({
      method: 'GET',
      url: `/v1/admin/clients/test-client-id/events?limit=1&before=${encodeURIComponent(secondBody.next_cursor)}`,
      headers: ADMIN_HEADER,
    });
    const thirdBody = JSON.parse(thirdPage.payload);
    expect(thirdBody.events).toHaveLength(1);
    expect(thirdBody.events[0].id).not.toBe(firstBody.events[0].id);
    expect(thirdBody.events[0].id).not.toBe(secondBody.events[0].id);
    expect(thirdBody.has_more).toBe(false);
  });

  test('paginates using before cursor and reports has_more + next_cursor', async () => {
    for (let i = 0; i < 5; i++) {
      addTestOAuthEvent({
        client_id: 'test-client-id',
        event_type: 'token_exchange',
        outcome: 'success',
        occurred_at: new Date(Date.now() - i * 1000),
      });
    }

    const firstPage = await app.inject({
      method: 'GET',
      url: '/v1/admin/clients/test-client-id/events?limit=2',
      headers: ADMIN_HEADER,
    });
    expect(firstPage.statusCode).toBe(200);
    const firstBody = JSON.parse(firstPage.payload);
    expect(firstBody.events).toHaveLength(2);
    expect(firstBody.has_more).toBe(true);
    expect(firstBody.next_cursor).toBeTruthy();

    const secondPage = await app.inject({
      method: 'GET',
      url: `/v1/admin/clients/test-client-id/events?limit=2&before=${encodeURIComponent(firstBody.next_cursor)}`,
      headers: ADMIN_HEADER,
    });
    const secondBody = JSON.parse(secondPage.payload);
    expect(secondBody.events).toHaveLength(2);
    expect(secondBody.has_more).toBe(true);

    const thirdPage = await app.inject({
      method: 'GET',
      url: `/v1/admin/clients/test-client-id/events?limit=2&before=${encodeURIComponent(secondBody.next_cursor)}`,
      headers: ADMIN_HEADER,
    });
    const thirdBody = JSON.parse(thirdPage.payload);
    expect(thirdBody.events).toHaveLength(1);
    expect(thirdBody.has_more).toBe(false);
    expect(thirdBody.next_cursor).toBeNull();
  });
});
