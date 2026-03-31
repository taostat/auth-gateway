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
import { generateS256Challenge } from '../../crypto/pkce';
import crypto from 'crypto';

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

async function createSessionAndChallenge(opts: {
  clientId: string;
  address: string;
  codeChallenge?: string;
}): Promise<{ sessionId: string; nonce: string }> {
  const { createAuthorizeSession } = require('../../db/authorizeSessions');
  const sessionId = await createAuthorizeSession({
    clientId: opts.clientId,
    redirectUri: 'http://localhost:3001/callback',
    scopes: [],
    codeChallenge: opts.codeChallenge,
  });
  const res = await browserPost(app, '/v1/oauth/challenge', { session_id: sessionId, address: opts.address });
  expect(res.statusCode).toBe(200);
  return { sessionId, nonce: JSON.parse(res.payload).nonce };
}

async function getAuthCodeWithPKCE(opts: {
  clientId: string;
  clientSecret?: string;
  codeChallenge: string;
}): Promise<string> {
  const address = await getAliceAddress();
  const { sessionId, nonce } = await createSessionAndChallenge({
    clientId: opts.clientId,
    address,
    codeChallenge: opts.codeChallenge,
  });
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

async function getAuthCodeWithoutPKCE(clientId: string): Promise<string> {
  const address = await getAliceAddress();
  const { sessionId, nonce } = await createSessionAndChallenge({ clientId, address });
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

function exchangeToken(opts: { code: string; clientId: string; clientSecret?: string; codeVerifier?: string }) {
  return app.inject({
    method: 'POST',
    url: '/v1/oauth/token',
    payload: {
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: 'http://localhost:3001/callback',
      client_id: opts.clientId,
      ...(opts.clientSecret ? { client_secret: opts.clientSecret } : {}),
      ...(opts.codeVerifier ? { code_verifier: opts.codeVerifier } : {}),
    },
  });
}

describe('RFC 7636 Compliance', () => {
  describe('4.1 Code Verifier', () => {
    test('code_verifier below minimum length (42 chars) is rejected', async () => {
      const verifier = 'a'.repeat(42);
      const challenge = generateS256Challenge(verifier);
      const code = await getAuthCodeWithPKCE({
        clientId: TEST_CLIENT_ID,
        codeChallenge: challenge,
      });

      const res = await exchangeToken({
        code,
        clientId: TEST_CLIENT_ID,
        clientSecret: TEST_CLIENT_SECRET,
        codeVerifier: verifier,
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('invalid_request');
    });

    test('code_verifier above maximum length (129 chars) is rejected', async () => {
      const verifier = 'a'.repeat(129);
      const challenge = generateS256Challenge(verifier);
      const code = await getAuthCodeWithPKCE({
        clientId: TEST_CLIENT_ID,
        codeChallenge: challenge,
      });

      const res = await exchangeToken({
        code,
        clientId: TEST_CLIENT_ID,
        clientSecret: TEST_CLIENT_SECRET,
        codeVerifier: verifier,
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('invalid_request');
    });

    test('code_verifier at exactly 43 chars succeeds', async () => {
      const verifier = 'a'.repeat(43);
      const challenge = generateS256Challenge(verifier);
      const code = await getAuthCodeWithPKCE({
        clientId: TEST_CLIENT_ID,
        codeChallenge: challenge,
      });

      const res = await exchangeToken({
        code,
        clientId: TEST_CLIENT_ID,
        clientSecret: TEST_CLIENT_SECRET,
        codeVerifier: verifier,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.access_token).toBeDefined();
    });

    test('code_verifier at exactly 128 chars succeeds', async () => {
      const verifier = 'a'.repeat(128);
      const challenge = generateS256Challenge(verifier);
      const code = await getAuthCodeWithPKCE({
        clientId: TEST_CLIENT_ID,
        codeChallenge: challenge,
      });

      const res = await exchangeToken({
        code,
        clientId: TEST_CLIENT_ID,
        clientSecret: TEST_CLIENT_SECRET,
        codeVerifier: verifier,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.access_token).toBeDefined();
    });

    test('code_verifier with invalid characters is rejected', async () => {
      const verifier = 'valid-verifier-padding-to-43-chars!@#$%^&*() ';
      const challenge = generateS256Challenge(verifier);
      const code = await getAuthCodeWithPKCE({
        clientId: TEST_CLIENT_ID,
        codeChallenge: challenge,
      });

      const res = await exchangeToken({
        code,
        clientId: TEST_CLIENT_ID,
        clientSecret: TEST_CLIENT_SECRET,
        codeVerifier: verifier,
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('invalid_request');
    });
  });

  describe('4.2 Code Challenge', () => {
    test('S256 produces BASE64URL(SHA256(ASCII(verifier)))', () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const expected = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');

      expect(generateS256Challenge(verifier)).toBe(expected);
    });

    test('S256 code_challenge_method is accepted', async () => {
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = generateS256Challenge(verifier);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/oauth/authorize',
        query: {
          client_id: TEST_CLIENT_ID,
          redirect_uri: 'http://localhost:3001/callback',
          response_type: 'code',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('4.3 Client Sends Code Challenge', () => {
    test('public client MUST include code_challenge in authorize', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/oauth/authorize',
        query: {
          client_id: 'public-test-client',
          redirect_uri: 'http://localhost:3001/callback',
          response_type: 'code',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.payload).toContain('PKCE Required');
    });

    test('confidential client MAY omit code_challenge in authorize', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/oauth/authorize',
        query: {
          client_id: TEST_CLIENT_ID,
          redirect_uri: 'http://localhost:3001/callback',
          response_type: 'code',
        },
      });

      expect(res.statusCode).toBe(200);
    });

    test('server policy requires explicit code_challenge_method=S256', async () => {
      const challenge = generateS256Challenge(crypto.randomBytes(32).toString('base64url'));

      const res = await app.inject({
        method: 'GET',
        url: '/v1/oauth/authorize',
        query: {
          client_id: TEST_CLIENT_ID,
          redirect_uri: 'http://localhost:3001/callback',
          response_type: 'code',
          code_challenge: challenge,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.payload).toContain('explicit code_challenge_method=S256');
    });
  });

  describe('4.4.1 Error Response', () => {
    test('code_challenge_method=plain is rejected', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/oauth/authorize',
        query: {
          client_id: TEST_CLIENT_ID,
          redirect_uri: 'http://localhost:3001/callback',
          response_type: 'code',
          code_challenge: 'a'.repeat(43),
          code_challenge_method: 'plain',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.payload).toContain('S256');
    });
  });

  describe('4.6 Server Verifies code_verifier', () => {
    test('correct code_verifier succeeds', async () => {
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = generateS256Challenge(verifier);
      const code = await getAuthCodeWithPKCE({
        clientId: TEST_CLIENT_ID,
        codeChallenge: challenge,
      });

      const res = await exchangeToken({
        code,
        clientId: TEST_CLIENT_ID,
        clientSecret: TEST_CLIENT_SECRET,
        codeVerifier: verifier,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeDefined();
    });

    test('wrong code_verifier returns invalid_grant', async () => {
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = generateS256Challenge(verifier);
      const code = await getAuthCodeWithPKCE({
        clientId: TEST_CLIENT_ID,
        codeChallenge: challenge,
      });

      const wrongVerifier = crypto.randomBytes(32).toString('base64url');
      const res = await exchangeToken({
        code,
        clientId: TEST_CLIENT_ID,
        clientSecret: TEST_CLIENT_SECRET,
        codeVerifier: wrongVerifier,
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('invalid_grant');
    });

    test('missing code_verifier when challenge was bound returns error', async () => {
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = generateS256Challenge(verifier);
      const code = await getAuthCodeWithPKCE({
        clientId: TEST_CLIENT_ID,
        codeChallenge: challenge,
      });

      const res = await exchangeToken({
        code,
        clientId: TEST_CLIENT_ID,
        clientSecret: TEST_CLIENT_SECRET,
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      const body = JSON.parse(res.payload);
      expect(body.error).toBeDefined();
    });

    test('code_verifier provided when no challenge was stored succeeds for confidential client', async () => {
      const code = await getAuthCodeWithoutPKCE(TEST_CLIENT_ID);
      const verifier = crypto.randomBytes(32).toString('base64url');

      const res = await exchangeToken({
        code,
        clientId: TEST_CLIENT_ID,
        clientSecret: TEST_CLIENT_SECRET,
        codeVerifier: verifier,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.access_token).toBeDefined();
    });
  });

  describe('7.2 Protection Against Eavesdroppers', () => {
    test('different verifiers produce different challenges', () => {
      const verifier1 = crypto.randomBytes(32).toString('base64url');
      const verifier2 = crypto.randomBytes(32).toString('base64url');

      const challenge1 = generateS256Challenge(verifier1);
      const challenge2 = generateS256Challenge(verifier2);

      expect(challenge1).not.toBe(challenge2);
    });
  });

  describe('Full PKCE Flow Integration', () => {
    test('complete public client PKCE flow', async () => {
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = generateS256Challenge(verifier);

      const authorizeRes = await app.inject({
        method: 'GET',
        url: '/v1/oauth/authorize',
        query: {
          client_id: 'public-test-client',
          redirect_uri: 'http://localhost:3001/callback',
          response_type: 'code',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        },
      });
      expect(authorizeRes.statusCode).toBe(200);

      const code = await getAuthCodeWithPKCE({
        clientId: 'public-test-client',
        codeChallenge: challenge,
      });

      const tokenRes = await exchangeToken({
        code,
        clientId: 'public-test-client',
        codeVerifier: verifier,
      });

      expect(tokenRes.statusCode).toBe(200);
      const body = JSON.parse(tokenRes.payload);
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeDefined();
      expect(body.token_type).toBe('Bearer');
      expect(body.expires_in).toBeGreaterThan(0);
    });

    test('complete confidential client PKCE flow', async () => {
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = generateS256Challenge(verifier);

      const authorizeRes = await app.inject({
        method: 'GET',
        url: '/v1/oauth/authorize',
        query: {
          client_id: TEST_CLIENT_ID,
          redirect_uri: 'http://localhost:3001/callback',
          response_type: 'code',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        },
      });
      expect(authorizeRes.statusCode).toBe(200);

      const code = await getAuthCodeWithPKCE({
        clientId: TEST_CLIENT_ID,
        codeChallenge: challenge,
      });

      const tokenRes = await exchangeToken({
        code,
        clientId: TEST_CLIENT_ID,
        clientSecret: TEST_CLIENT_SECRET,
        codeVerifier: verifier,
      });

      expect(tokenRes.statusCode).toBe(200);
      const body = JSON.parse(tokenRes.payload);
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeDefined();
      expect(body.token_type).toBe('Bearer');
      expect(body.expires_in).toBeGreaterThan(0);
    });
  });
});
