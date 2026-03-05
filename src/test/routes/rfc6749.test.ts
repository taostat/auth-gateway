import { cryptoWaitReady } from '@polkadot/util-crypto';
import {
  setupMockDb,
  createTestClient,
  createPublicTestClient,
  addTestClient,
  clearTestClients,
  clearTestRefreshTokens,
  clearTestChallenges,
  clearTestConsumedCodes,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
} from '../helpers/mockDb';
import { createMockApi, MockChainBuilder } from '../helpers/mockSubtensor';

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
import { browserPost, buildTestApp } from '../helpers/app';
import { getAliceAddress, signWithAlice } from '../helpers/sign';

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
  clearTestConsumedCodes();
  clearTestClients();
  clearTestRefreshTokens();
  addTestClient(createTestClient());
  addTestClient(createPublicTestClient());
});

async function getAuthCode(opts?: {
  clientId?: string;
  redirectUri?: string;
  scopes?: string[];
  codeChallenge?: string;
  oidcNonce?: string;
}): Promise<string> {
  const address = await getAliceAddress();
  const clientId = opts?.clientId ?? TEST_CLIENT_ID;
  const redirectUri = opts?.redirectUri ?? 'http://localhost:3001/callback';
  const { createAuthorizeSession } = require('../../db/authorizeSessions');
  const sessionId = await createAuthorizeSession({
    clientId,
    redirectUri,
    scopes: opts?.scopes ?? [],
    codeChallenge: opts?.codeChallenge,
    oidcNonce: opts?.oidcNonce,
  });

  const challengeRes = await browserPost(app, '/v1/oauth/challenge', { session_id: sessionId, address });
  expect(challengeRes.statusCode).toBe(200);
  const { nonce } = JSON.parse(challengeRes.payload);
  const signature = await signWithAlice(nonce);

  const callbackRes = await browserPost(app, '/v1/oauth/callback', {
    session_id: sessionId,
    nonce,
    address,
    signature,
  });
  expect(callbackRes.statusCode).toBe(200);
  return JSON.parse(callbackRes.payload).code;
}

async function exchangeCode(code: string, overrides?: Record<string, string>) {
  return app.inject({
    method: 'POST',
    url: '/v1/oauth/token',
    payload: {
      grant_type: 'authorization_code',
      code,
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
      redirect_uri: 'http://localhost:3001/callback',
      ...overrides,
    },
  });
}

describe('RFC 6749 Compliance', () => {
  describe('§3.1 Authorization Endpoint', () => {
    test('MUST ignore unrecognized query parameters', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/oauth/authorize?client_id=${TEST_CLIENT_ID}&redirect_uri=http://localhost:3001/callback&response_type=code&foo=bar`,
      });
      expect(res.statusCode).toBe(200);
    });

    test('MUST NOT redirect on invalid redirect_uri', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/oauth/authorize?client_id=${TEST_CLIENT_ID}&redirect_uri=http://evil.com/callback&response_type=code`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['location']).toBeUndefined();
    });
  });

  describe('§3.2 Token Endpoint', () => {
    test('MUST ignore unrecognized body parameters', async () => {
      const code = await getAuthCode();
      const res = await exchangeCode(code, { foo: 'bar' });
      expect(res.statusCode).toBe(200);
    });

    test('rejects GET requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/oauth/token',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('§4.1.1 Authorization Request', () => {
    test('response_type is validated', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/oauth/authorize?client_id=${TEST_CLIENT_ID}&redirect_uri=http://localhost:3001/callback`,
      });
      expect(res.statusCode).toBe(400);
    });

    test('invalid response_type rejected', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/oauth/authorize?client_id=${TEST_CLIENT_ID}&redirect_uri=http://localhost:3001/callback&response_type=token`,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('§4.1.2 Authorization Response', () => {
    test('state parameter passed through to callback HTML', async () => {
      const state = 'xyzzy-random-state-123';
      const res = await app.inject({
        method: 'GET',
        url: `/v1/oauth/authorize?client_id=${TEST_CLIENT_ID}&redirect_uri=http://localhost:3001/callback&response_type=code&state=${state}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.payload).toContain(state);
    });

    test('authorization code is single-use', async () => {
      const code = await getAuthCode();

      const first = await exchangeCode(code);
      expect(first.statusCode).toBe(200);

      const second = await exchangeCode(code);
      expect(second.statusCode).toBe(401);
      const body = JSON.parse(second.payload);
      expect(body.error).toBe('invalid_grant');
    });
  });

  describe('§4.1.3 Token Request', () => {
    test('missing code parameter returns invalid_request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('invalid_request');
    });

    test('redirect_uri mismatch between authorize and token', async () => {
      const code = await getAuthCode({
        redirectUri: 'http://localhost:3001/callback',
      });

      const res = await exchangeCode(code, {
        redirect_uri: 'http://localhost:3001/other',
      });
      expect(res.statusCode).toBe(400);
    });

    test('missing redirect_uri when it was in auth code', async () => {
      const code = await getAuthCode({
        redirectUri: 'http://localhost:3001/callback',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('§5.1 Successful Response', () => {
    test('response includes required fields', async () => {
      const code = await getAuthCode();
      const res = await exchangeCode(code);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.access_token).toBeDefined();
      expect(body.token_type).toBeDefined();
      expect(body.expires_in).toBeDefined();
    });

    test('token_type is Bearer', async () => {
      const code = await getAuthCode();
      const res = await exchangeCode(code);
      const body = JSON.parse(res.payload);
      expect(body.token_type).toBe('Bearer');
    });

    test('response content-type is application/json', async () => {
      const code = await getAuthCode();
      const res = await exchangeCode(code);
      expect(res.headers['content-type']).toContain('application/json');
    });

    test('Cache-Control: no-store header', async () => {
      const code = await getAuthCode();
      const res = await exchangeCode(code);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    test('Pragma: no-cache header', async () => {
      const code = await getAuthCode();
      const res = await exchangeCode(code);
      expect(res.headers['pragma']).toBe('no-cache');
    });
  });

  describe('§5.2 Error Response', () => {
    test('error response includes error field', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code: 'garbage',
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      const body = JSON.parse(res.payload);
      expect(body.error).toBeDefined();
    });

    test('invalid_grant for bad code', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code: 'totally-invalid-code',
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('invalid_grant');
    });

    test('unsupported_grant_type for unknown grant', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'password',
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('unsupported_grant_type');
    });
  });

  describe('§10.6 Redirect URI Manipulation', () => {
    test('redirect_uri must match exactly (trailing slash rejected)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/oauth/authorize?client_id=${TEST_CLIENT_ID}&redirect_uri=http://localhost:3001/callback/&response_type=code`,
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
