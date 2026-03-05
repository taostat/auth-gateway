import { escapeHtml } from '../../util/html';
import { setupMockDb, createTestClient, createPublicTestClient, addTestClient, clearTestClients, clearTestChallenges, clearTestDeviceCodes, TEST_CLIENT_ID } from '../helpers/mockDb';
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

jest.mock('../../subtensor/queries', () => {
  const actual = jest.requireActual('../../subtensor/queries');
  return {
    ...actual,
    getCurrentEpoch: jest.fn().mockResolvedValue(100),
    getSecondsUntilNextEpoch: jest.fn().mockResolvedValue(600),
    getEpochDetails: jest.fn().mockResolvedValue({ secondsUntilNextEpoch: 600, currentEpoch: 100 }),
  };
});

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
  clearTestChallenges();
  clearTestDeviceCodes();
  addTestClient(createTestClient());
  addTestClient(createPublicTestClient());
});

describe('escapeHtml utility', () => {
  test('escapes < and > characters', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  test('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  test('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  test('handles combined special characters', () => {
    expect(escapeHtml('<img src="x" onerror=\'alert(1)\'>')).toBe(
      '&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;',
    );
  });

  test('passes through normal text unchanged', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });
});

describe('XSS prevention in HTML pages', () => {
  test('oauth error page does not include raw HTML in error output', async () => {
    // The error page uses escapeHtml on title and message.
    // With an unknown client_id, the message is static ("not registered"), so test
    // that the errorPage escaping works by verifying the page is well-formed
    // and doesn't reflect the client_id unsafely.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/oauth/authorize?client_id=<script>alert(1)</script>&redirect_uri=http://test',
    });
    expect(res.statusCode).toBe(400);
    // The error page uses static messages — confirm no script tags in output
    expect(res.payload).not.toContain('<script>alert(1)</script>');
    expect(res.payload).toContain('Unknown Application');
  });

  test('device verify page escapes user_code in input value', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/device/verify?user_code="><script>alert(1)</script>',
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain('"><script>alert(1)</script>');
    expect(res.payload).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('oauth authorize page escapes client_name', async () => {
    addTestClient(createTestClient({
      client_id: 'xss-client',
      client_name: '<img src=x onerror=alert(1)>',
      redirect_uris: ['http://localhost:3001/callback'],
    }));
    const res = await app.inject({
      method: 'GET',
      url: '/v1/oauth/authorize?client_id=xss-client&redirect_uri=http://localhost:3001/callback&response_type=code',
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain('<img src=x onerror=alert(1)>');
    expect(res.payload).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('oauth authorize page escapes </script> in state', async () => {
    const payload = '</script><script>alert(1)</script>';
    const res = await app.inject({
      method: 'GET',
      url: `/v1/oauth/authorize?client_id=${TEST_CLIENT_ID}&redirect_uri=http://localhost:3001/callback&response_type=code&state=${encodeURIComponent(payload)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain(payload);
    expect(res.payload).toContain('\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e');
  });

  test('html pages include CSP and frame protection headers', async () => {
    const oauthRes = await app.inject({
      method: 'GET',
      url: `/v1/oauth/authorize?client_id=${TEST_CLIENT_ID}&redirect_uri=http://localhost:3001/callback&response_type=code`,
    });
    expect(oauthRes.statusCode).toBe(200);
    expect(oauthRes.headers['content-security-policy']).toContain("default-src 'self'");
    expect(oauthRes.headers['x-frame-options']).toBe('DENY');

    const deviceRes = await app.inject({
      method: 'GET',
      url: '/v1/device/verify',
    });
    expect(deviceRes.statusCode).toBe(200);
    expect(deviceRes.headers['content-security-policy']).toContain("default-src 'self'");
    expect(deviceRes.headers['x-frame-options']).toBe('DENY');
  });
});
