import { cryptoWaitReady } from '@polkadot/util-crypto';
import {
  setupMockDb,
  createTestClient,
  createPublicTestClient,
  addTestClient,
  clearTestClients,
  clearTestRefreshTokens,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
} from '../helpers/mockDb';
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

// Mock getCurrentEpoch
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
import { clearTestChallenges, clearTestConsumedCodes } from '../helpers/mockDb';
import { verifyIdToken, verifyToken, computeAtHash } from '../../crypto/jwt';
import { getPrivateKey, getKid } from '../../crypto/keys';
import { config } from '../../config';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

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

function postOAuthCallback(payload: { session_id: string; nonce: string; address: string; signature: string }) {
  return browserPost(app, '/v1/oauth/callback', payload);
}

async function createSession(opts?: {
  clientId?: string;
  redirectUri?: string;
  scopes?: string[];
  codeChallenge?: string;
  oidcNonce?: string;
}): Promise<string> {
  const { createAuthorizeSession } = require('../../db/authorizeSessions');
  return createAuthorizeSession({
    clientId: opts?.clientId ?? TEST_CLIENT_ID,
    redirectUri: opts?.redirectUri ?? 'http://localhost:3001/callback',
    scopes: opts?.scopes ?? [],
    codeChallenge: opts?.codeChallenge,
    oidcNonce: opts?.oidcNonce,
  });
}

async function getOAuthChallenge(opts: {
  clientId?: string;
  redirectUri?: string;
  address?: string;
  scopes?: string[];
  codeChallenge?: string;
  oidcNonce?: string;
}): Promise<{ sessionId: string; nonce: string }> {
  const sessionId = await createSession({
    clientId: opts.clientId,
    redirectUri: opts.redirectUri,
    scopes: opts.scopes,
    codeChallenge: opts.codeChallenge,
    oidcNonce: opts.oidcNonce,
  });
  const res = await browserPost(app, '/v1/oauth/challenge', {
    session_id: sessionId,
    ...(opts.address ? { address: opts.address } : {}),
  });
  expect(res.statusCode).toBe(200);
  const { nonce } = JSON.parse(res.payload);
  return { sessionId, nonce };
}

describe('OAuth Routes', () => {
  describe('GET /v1/oauth/authorize', () => {
    test('returns HTML page with valid registered client', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/oauth/authorize?client_id=${TEST_CLIENT_ID}&redirect_uri=http://localhost:3001/callback&response_type=code`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.payload).toContain('Authorize access');
      expect(res.payload).toContain('Test App'); // Shows client_name
    });

    test('returns 400 without client_id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/oauth/authorize?redirect_uri=http://localhost/callback',
      });
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 for unknown client_id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/oauth/authorize?client_id=unknown-client&redirect_uri=http://localhost/callback&response_type=code',
      });
      expect(res.statusCode).toBe(400);
      expect(res.payload).toContain('not registered');
    });

    test('returns 400 for unregistered redirect_uri', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/oauth/authorize?client_id=${TEST_CLIENT_ID}&redirect_uri=http://evil.com/callback&response_type=code`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.payload).toContain('not registered');
    });

    test('public client requires PKCE', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/oauth/authorize?client_id=public-test-client&redirect_uri=http://localhost:3001/callback&response_type=code',
      });
      expect(res.statusCode).toBe(400);
      expect(res.payload).toContain('PKCE');
    });

    test('public client with PKCE succeeds', async () => {
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = generateS256Challenge(verifier);
      const res = await app.inject({
        method: 'GET',
        url: `/v1/oauth/authorize?client_id=public-test-client&redirect_uri=http://localhost:3001/callback&response_type=code&code_challenge=${challenge}&code_challenge_method=S256`,
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('POST /v1/oauth/token', () => {
    test('requires Origin header for browser-only OAuth challenge route', async () => {
      const sessionId = await createSession();

      const res = await app.inject({
        method: 'POST',
        url: '/v1/oauth/challenge',
        payload: { session_id: sessionId },
      });

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.payload).message).toBe('Origin header required');
    });

    test('rejects direct auth challenges at OAuth callback', async () => {
      const address = await getAliceAddress();

      // Create a session for the callback
      const sessionId = await createSession();

      // But use a nonce from the auth challenge flow (not OAuth)
      const challengeRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address },
      });
      const { nonce } = JSON.parse(challengeRes.payload);
      const signature = await signWithAlice(nonce);

      const callbackRes = await postOAuthCallback({ session_id: sessionId, nonce, address, signature });

      expect(callbackRes.statusCode).toBe(400);
      expect(JSON.parse(callbackRes.payload).message).toContain('different authentication flow');
    });

    test('exchanges auth code for tokens with client auth', async () => {
      const address = await getAliceAddress();

      // Create challenge and get auth code via callback
      const { sessionId, nonce } = await getOAuthChallenge({ address, clientId: TEST_CLIENT_ID });
      const signature = await signWithAlice(nonce);

      const callbackRes = await postOAuthCallback({ session_id: sessionId, nonce, address, signature });
      expect(callbackRes.statusCode).toBe(200);
      const { code } = JSON.parse(callbackRes.payload);

      // Exchange code for tokens (with client auth)
      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      expect(tokenRes.statusCode).toBe(200);
      const body = JSON.parse(tokenRes.payload);
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeDefined();
      expect(body.token_type).toBe('Bearer');
      expect(body.scope).toBeDefined();
    });

    test('returns 401 for invalid auth code', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code: 'invalid-code',
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(res.statusCode).toBe(401);
    });

    test('returns 401 without client credentials', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code: 'some-code',
        },
      });
      expect(res.statusCode).toBe(401);
    });

    test('PKCE flow works for public client', async () => {
      const address = await getAliceAddress();
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = generateS256Challenge(codeVerifier);

      // Challenge (code_challenge stored in session)
      const { sessionId, nonce } = await getOAuthChallenge({
        address,
        clientId: 'public-test-client',
        codeChallenge,
      });
      const signature = await signWithAlice(nonce);

      // Callback
      const callbackRes = await postOAuthCallback({ session_id: sessionId, nonce, address, signature });
      expect(callbackRes.statusCode).toBe(200);
      const { code } = JSON.parse(callbackRes.payload);
      const claims = verifyToken(code);
      expect(claims.code_challenge).toBe(codeChallenge);
      expect(claims.code_challenge_method).toBe('S256');

      // Token exchange with code_verifier
      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: 'public-test-client',
          code_verifier: codeVerifier,
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      expect(tokenRes.statusCode).toBe(200);
      const body = JSON.parse(tokenRes.payload);
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeDefined();
      expect(body.scope).toBeDefined();
    });

    test('PKCE rejects wrong code_verifier', async () => {
      const address = await getAliceAddress();
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = generateS256Challenge(codeVerifier);

      const { sessionId, nonce } = await getOAuthChallenge({
        address,
        clientId: 'public-test-client',
        codeChallenge,
      });
      const signature = await signWithAlice(nonce);

      const callbackRes = await postOAuthCallback({ session_id: sessionId, nonce, address, signature });
      const { code } = JSON.parse(callbackRes.payload);

      // Wrong verifier
      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: 'public-test-client',
          code_verifier: crypto.randomBytes(32).toString('base64url'),
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      expect(tokenRes.statusCode).toBe(401);
    });

    test('accepts legacy auth codes that have code_challenge without code_challenge_method', async () => {
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = generateS256Challenge(codeVerifier);
      const legacyCode = jwt.sign(
        {
          sub: ALICE,
          scope: '',
          type: 'auth_code',
          jti: crypto.randomUUID(),
          client_id: TEST_CLIENT_ID,
          redirect_uri: 'http://localhost:3001/callback',
          code_challenge: codeChallenge,
          hotkey: ALICE,
          coldkey: ALICE,
          evm_address: null,
        },
        getPrivateKey(),
        {
          algorithm: 'RS256',
          issuer: config.jwtIssuer,
          audience: config.jwtAudience,
          expiresIn: config.jwtAuthCodeExpiry,
          keyid: getKid(),
        },
      );

      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code: legacyCode,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
          code_verifier: codeVerifier,
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      expect(tokenRes.statusCode).toBe(200);
    });
  });

  describe('POST /v1/oauth/refresh', () => {
    test('refreshes token pair with client auth and DB-backed rotation', async () => {
      const address = await getAliceAddress();

      // Get initial tokens
      const { sessionId, nonce } = await getOAuthChallenge({ address });
      const signature = await signWithAlice(nonce);

      const callbackRes = await postOAuthCallback({ session_id: sessionId, nonce, address, signature });
      const { code } = JSON.parse(callbackRes.payload);

      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      const { refresh_token } = JSON.parse(tokenRes.payload);

      // Refresh
      const refreshRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/refresh',
        payload: {
          grant_type: 'refresh_token',
          refresh_token,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(refreshRes.statusCode).toBe(200);
      const body = JSON.parse(refreshRes.payload);
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeDefined();
      expect(body.scope).toBeDefined();
      // New refresh token should be different (rotation)
      expect(body.refresh_token).not.toBe(refresh_token);
    });

    test('returns 401 for invalid refresh token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/oauth/refresh',
        payload: {
          grant_type: 'refresh_token',
          refresh_token: 'invalid-token',
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(res.statusCode).toBe(401);
    });

    test('returns 401 without client credentials', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/oauth/refresh',
        payload: {
          grant_type: 'refresh_token',
          refresh_token: 'some-token',
        },
      });
      expect(res.statusCode).toBe(401);
    });

    test('refreshes scoped token when on-chain role is still valid', async () => {
      const address = await getAliceAddress();

      // Register a client that allows the scope
      addTestClient(
        createTestClient({
          client_id: 'scoped-client',
          client_name: 'Scoped App',
          allowed_scopes: ['subnet:1:miner'],
          redirect_uris: ['http://localhost:3001/callback'],
        }),
      );

      // Full flow: challenge -> sign -> callback -> token exchange -> refresh
      const { sessionId, nonce } = await getOAuthChallenge({
        address,
        clientId: 'scoped-client',
        scopes: ['subnet:1:miner'],
      });
      const signature = await signWithAlice(nonce);

      const callbackRes = await postOAuthCallback({ session_id: sessionId, nonce, address, signature });
      expect(callbackRes.statusCode).toBe(200);
      const { code } = JSON.parse(callbackRes.payload);

      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: 'scoped-client',
          client_secret: TEST_CLIENT_SECRET,
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      expect(tokenRes.statusCode).toBe(200);
      const { refresh_token } = JSON.parse(tokenRes.payload);

      // Refresh should succeed because Alice is still a miner
      const refreshRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/refresh',
        payload: {
          grant_type: 'refresh_token',
          refresh_token,
          client_id: 'scoped-client',
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(refreshRes.statusCode).toBe(200);
      const body = JSON.parse(refreshRes.payload);
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeDefined();
      expect(body.scope).toBeDefined();
    });

    test('refresh rejects with 403 when address loses on-chain role', async () => {
      const address = await getAliceAddress();

      addTestClient(
        createTestClient({
          client_id: 'scoped-client-2',
          client_name: 'Scoped App 2',
          allowed_scopes: ['subnet:1:miner'],
          redirect_uris: ['http://localhost:3001/callback'],
        }),
      );

      // Full flow to get refresh token
      const { sessionId, nonce } = await getOAuthChallenge({
        address,
        clientId: 'scoped-client-2',
        scopes: ['subnet:1:miner'],
      });
      const signature = await signWithAlice(nonce);

      const callbackRes = await postOAuthCallback({ session_id: sessionId, nonce, address, signature });
      expect(callbackRes.statusCode).toBe(200);
      const { code } = JSON.parse(callbackRes.payload);

      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: 'scoped-client-2',
          client_secret: TEST_CLIENT_SECRET,
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      expect(tokenRes.statusCode).toBe(200);
      const { refresh_token } = JSON.parse(tokenRes.payload);

      // Swap mock chain state: Alice is no longer registered
      const emptyBuilder = new MockChainBuilder();
      const emptyMockApi = createMockApi(emptyBuilder.getState());
      const getSubtensorApi = require('../../subtensor/client').getSubtensorApi as jest.Mock;
      const originalImpl = getSubtensorApi.getMockImplementation();
      getSubtensorApi.mockResolvedValue(emptyMockApi);

      try {
        // Refresh should fail because Alice is no longer a miner
        const refreshRes = await app.inject({
          method: 'POST',
          url: '/v1/oauth/refresh',
          payload: {
            grant_type: 'refresh_token',
            refresh_token,
            client_id: 'scoped-client-2',
            client_secret: TEST_CLIENT_SECRET,
          },
        });
        expect(refreshRes.statusCode).toBe(403);
      } finally {
        // Restore original mock
        if (originalImpl) {
          getSubtensorApi.mockImplementation(originalImpl);
        } else {
          getSubtensorApi.mockResolvedValue(mockApi);
        }
      }
    });

    test('refreshes via unified /v1/oauth/token endpoint', async () => {
      const address = await getAliceAddress();

      // Get tokens via full flow
      const { sessionId, nonce } = await getOAuthChallenge({ address });
      const signature = await signWithAlice(nonce);

      const callbackRes = await postOAuthCallback({ session_id: sessionId, nonce, address, signature });
      const { code } = JSON.parse(callbackRes.payload);

      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      const { refresh_token } = JSON.parse(tokenRes.payload);

      // Refresh via unified endpoint
      const refreshRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'refresh_token',
          refresh_token,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(refreshRes.statusCode).toBe(200);
      const body = JSON.parse(refreshRes.payload);
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeDefined();
      expect(body.scope).toBeDefined();
    });
  });

  describe('Auth code single-use enforcement', () => {
    test('rejects auth code replay (single-use)', async () => {
      const address = await getAliceAddress();

      // Create challenge and get auth code
      const { sessionId, nonce } = await getOAuthChallenge({ address });
      const signature = await signWithAlice(nonce);

      const callbackRes = await postOAuthCallback({ session_id: sessionId, nonce, address, signature });
      expect(callbackRes.statusCode).toBe(200);
      const { code } = JSON.parse(callbackRes.payload);

      // First exchange should succeed
      const tokenRes1 = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      expect(tokenRes1.statusCode).toBe(200);

      // Second exchange should fail (auth code replay)
      const tokenRes2 = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      expect(tokenRes2.statusCode).toBe(401);
      const body = JSON.parse(tokenRes2.payload);
      expect(body.message).toContain('already been used');
      expect(body.error_description).toContain('already been used');
    });

    test('rejects token exchange when redirect_uri omitted but was in auth code', async () => {
      const address = await getAliceAddress();

      const { sessionId, nonce } = await getOAuthChallenge({ address, clientId: TEST_CLIENT_ID });
      const signature = await signWithAlice(nonce);

      const callbackRes = await postOAuthCallback({ session_id: sessionId, nonce, address, signature });
      expect(callbackRes.statusCode).toBe(200);
      const { code } = JSON.parse(callbackRes.payload);

      // Exchange without redirect_uri — should fail because auth code had one
      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
          // redirect_uri intentionally omitted
        },
      });
      expect(tokenRes.statusCode).toBe(400);
      const body = JSON.parse(tokenRes.payload);
      expect(body.message).toContain('redirect_uri');
      expect(body.error_description).toContain('redirect_uri');
    });

    test('auth code not consumed when PKCE validation fails (retry with correct verifier succeeds)', async () => {
      const address = await getAliceAddress();
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = generateS256Challenge(codeVerifier);

      const { sessionId, nonce } = await getOAuthChallenge({
        address,
        clientId: 'public-test-client',
        codeChallenge,
      });
      const signature = await signWithAlice(nonce);

      const callbackRes = await postOAuthCallback({ session_id: sessionId, nonce, address, signature });
      expect(callbackRes.statusCode).toBe(200);
      const { code } = JSON.parse(callbackRes.payload);

      // First attempt with WRONG verifier — should fail
      const wrongRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: 'public-test-client',
          code_verifier: crypto.randomBytes(32).toString('base64url'),
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      expect(wrongRes.statusCode).toBe(401);

      // Second attempt with CORRECT verifier — should succeed (code was not consumed)
      const correctRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: 'public-test-client',
          code_verifier: codeVerifier,
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      expect(correctRes.statusCode).toBe(200);
      const body = JSON.parse(correctRes.payload);
      expect(body.access_token).toBeDefined();
    });

    test('auth code not consumed when redirect_uri mismatches (retry with correct URI succeeds)', async () => {
      const address = await getAliceAddress();

      const { sessionId, nonce } = await getOAuthChallenge({ address });
      const signature = await signWithAlice(nonce);

      const callbackRes = await postOAuthCallback({ session_id: sessionId, nonce, address, signature });
      expect(callbackRes.statusCode).toBe(200);
      const { code } = JSON.parse(callbackRes.payload);

      // Wrong redirect_uri
      const wrongRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
          redirect_uri: 'http://wrong.com/callback',
        },
      });
      expect(wrongRes.statusCode).toBe(400);

      // Correct redirect_uri — should succeed
      const correctRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      expect(correctRes.statusCode).toBe(200);
    });
  });

  describe('client isolation', () => {
    test('rejects refresh token issued to a different client', async () => {
      const address = await getAliceAddress();

      // Get tokens via full flow with test-client
      const { sessionId, nonce } = await getOAuthChallenge({ address });
      const signature = await signWithAlice(nonce);

      const callbackRes = await postOAuthCallback({ session_id: sessionId, nonce, address, signature });
      const { code } = JSON.parse(callbackRes.payload);

      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      expect(tokenRes.statusCode).toBe(200);
      const { refresh_token } = JSON.parse(tokenRes.payload);

      // Register a second client
      addTestClient(
        createTestClient({
          client_id: 'other-client',
          client_name: 'Other App',
          redirect_uris: ['http://localhost:3001/callback'],
        }),
      );

      // Try to use the refresh token with the other client
      const refreshRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/refresh',
        payload: {
          grant_type: 'refresh_token',
          refresh_token,
          client_id: 'other-client',
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(refreshRes.statusCode).toBe(401);
      const body = JSON.parse(refreshRes.payload);
      expect(body.error).toBe('invalid_client');
    });

    test('rejects auth code issued to a different client', async () => {
      const address = await getAliceAddress();

      // Get auth code bound to test-client
      const { sessionId, nonce } = await getOAuthChallenge({ address });
      const signature = await signWithAlice(nonce);

      const callbackRes = await postOAuthCallback({ session_id: sessionId, nonce, address, signature });
      expect(callbackRes.statusCode).toBe(200);
      const { code } = JSON.parse(callbackRes.payload);

      // Register a second client
      addTestClient(
        createTestClient({
          client_id: 'other-client',
          client_name: 'Other App',
          redirect_uris: ['http://localhost:3001/callback'],
        }),
      );

      // Try to exchange the auth code with the other client
      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: 'other-client',
          client_secret: TEST_CLIENT_SECRET,
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      expect(tokenRes.statusCode).toBe(401);
    });
  });

  describe('PKCE downgrade prevention', () => {
    test('rejects token exchange when code_verifier is missing but code_challenge was provided', async () => {
      const address = await getAliceAddress();
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = generateS256Challenge(codeVerifier);

      // code_challenge stored in session
      const { sessionId, nonce } = await getOAuthChallenge({ address, codeChallenge });
      const signature = await signWithAlice(nonce);

      // Issue auth code WITH code_challenge (using confidential client)
      const callbackRes = await postOAuthCallback({ session_id: sessionId, nonce, address, signature });
      expect(callbackRes.statusCode).toBe(200);
      const { code } = JSON.parse(callbackRes.payload);

      // Exchange WITHOUT code_verifier — should be rejected
      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      expect(tokenRes.statusCode).toBe(400);
      const body = JSON.parse(tokenRes.payload);
      expect(body.error).toBe('invalid_request');
      expect(body.error_description).toContain('PKCE');
    });
  });

  describe('refresh token revocation', () => {
    test('rejects a revoked refresh token', async () => {
      const address = await getAliceAddress();

      // Get initial tokens
      const { sessionId, nonce } = await getOAuthChallenge({ address });
      const signature = await signWithAlice(nonce);

      const callbackRes = await postOAuthCallback({ session_id: sessionId, nonce, address, signature });
      const { code } = JSON.parse(callbackRes.payload);

      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      expect(tokenRes.statusCode).toBe(200);
      const { refresh_token: firstRefresh } = JSON.parse(tokenRes.payload);

      // Rotate: use the refresh token once (old one gets revoked)
      const refreshRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/refresh',
        payload: {
          grant_type: 'refresh_token',
          refresh_token: firstRefresh,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(refreshRes.statusCode).toBe(200);
      const { refresh_token: secondRefresh } = JSON.parse(refreshRes.payload);
      expect(secondRefresh).not.toBe(firstRefresh);

      // Try to use the OLD (revoked) refresh token again
      const reuseRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/refresh',
        payload: {
          grant_type: 'refresh_token',
          refresh_token: firstRefresh,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(reuseRes.statusCode).toBe(401);
      const body = JSON.parse(reuseRes.payload);
      expect(body.error_description).toMatch(/revoked/i);
    });
  });

  describe('concurrent refresh token rotation', () => {
    test('rejects second concurrent use of the same refresh token', async () => {
      const address = await getAliceAddress();

      // Get initial tokens via full OAuth flow
      const { sessionId, nonce } = await getOAuthChallenge({ address });
      const signature = await signWithAlice(nonce);

      const callbackRes = await postOAuthCallback({ session_id: sessionId, nonce, address, signature });
      const { code } = JSON.parse(callbackRes.payload);

      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      expect(tokenRes.statusCode).toBe(200);
      const { refresh_token } = JSON.parse(tokenRes.payload);

      // Send two refresh requests simultaneously with the same token
      const refreshPayload = {
        grant_type: 'refresh_token',
        refresh_token,
        client_id: TEST_CLIENT_ID,
        client_secret: TEST_CLIENT_SECRET,
      };

      const [res1, res2] = await Promise.all([
        app.inject({ method: 'POST', url: '/v1/oauth/refresh', payload: refreshPayload }),
        app.inject({ method: 'POST', url: '/v1/oauth/refresh', payload: refreshPayload }),
      ]);

      const statuses = [res1.statusCode, res2.statusCode].sort((a, b) => a - b);
      // Exactly one should succeed (200) and one should fail (401)
      expect(statuses).toEqual([200, 401]);

      // The failing response should indicate revocation
      const failedRes = res1.statusCode === 401 ? res1 : res2;
      const failedBody = JSON.parse(failedRes.payload);
      expect(failedBody.error).toBe('invalid_grant');
      expect(failedBody.error_description).toMatch(/revoked/i);

      // The successful response should have new tokens
      const successRes = res1.statusCode === 200 ? res1 : res2;
      const successBody = JSON.parse(successRes.payload);
      expect(successBody.access_token).toBeDefined();
      expect(successBody.refresh_token).toBeDefined();
      expect(successBody.refresh_token).not.toBe(refresh_token);
    });
  });

  describe('ID token issuance', () => {
    async function getTokensViaAuthCode(
      opts: { scopes?: string[]; oidcNonce?: string } = {},
    ): Promise<Record<string, unknown>> {
      const scopes = opts.scopes ?? ['openid'];
      const address = await getAliceAddress();
      const { sessionId, nonce } = await getOAuthChallenge({
        address,
        scopes,
        oidcNonce: opts.oidcNonce,
      });
      const signature = await signWithAlice(nonce);

      const callbackRes = await postOAuthCallback({ session_id: sessionId, nonce, address, signature });
      expect(callbackRes.statusCode).toBe(200);
      const { code } = JSON.parse(callbackRes.payload);

      const tokenRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          code,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
          redirect_uri: 'http://localhost:3001/callback',
        },
      });
      expect(tokenRes.statusCode).toBe(200);
      return JSON.parse(tokenRes.payload);
    }

    test('token response includes id_token', async () => {
      const body = await getTokensViaAuthCode();
      expect(body.id_token).toBeDefined();
      expect(typeof body.id_token).toBe('string');
    });

    test('id_token has correct claims and aud is client_id', async () => {
      const body = await getTokensViaAuthCode();
      const claims = verifyIdToken(body.id_token as string, TEST_CLIENT_ID);
      expect(claims.type).toBe('id');
      expect(claims.sub).toBe(await getAliceAddress());
      expect(claims.aud).toBe(TEST_CLIENT_ID);
      expect(claims.at_hash).toBeDefined();
      expect(claims.auth_time).toBeDefined();
      expect(typeof claims.auth_time).toBe('number');
    });

    test('at_hash matches access token', async () => {
      const body = await getTokensViaAuthCode();
      const claims = verifyIdToken(body.id_token as string, TEST_CLIENT_ID);
      expect(claims.at_hash).toBe(computeAtHash(body.access_token as string));
    });

    test('id_token is absent when openid scope not requested', async () => {
      const body = await getTokensViaAuthCode({ scopes: [] });
      expect(body.id_token).toBeUndefined();
    });

    test('nonce is included in id_token when provided', async () => {
      const oidcNonce = 'test-nonce-12345';
      const body = await getTokensViaAuthCode({ oidcNonce });
      const claims = verifyIdToken(body.id_token as string, TEST_CLIENT_ID);
      expect(claims.nonce).toBe(oidcNonce);
    });

    test('nonce is absent from id_token when not provided', async () => {
      const body = await getTokensViaAuthCode();
      const claims = verifyIdToken(body.id_token as string, TEST_CLIENT_ID);
      expect(claims.nonce).toBeUndefined();
    });

    test('id_token fails verification with wrong audience', async () => {
      const body = await getTokensViaAuthCode();
      expect(() => verifyIdToken(body.id_token as string, 'wrong-client-id')).toThrow();
    });

    test('refresh token response includes id_token with stable auth_time', async () => {
      const body = await getTokensViaAuthCode();
      const origClaims = verifyIdToken(body.id_token as string, TEST_CLIENT_ID);

      const refreshRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'refresh_token',
          refresh_token: body.refresh_token,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(refreshRes.statusCode).toBe(200);
      const refreshBody = JSON.parse(refreshRes.payload);
      expect(refreshBody.id_token).toBeDefined();

      const claims = verifyIdToken(refreshBody.id_token as string, TEST_CLIENT_ID);
      expect(claims.type).toBe('id');
      expect(claims.aud).toBe(TEST_CLIENT_ID);
      expect(claims.at_hash).toBe(computeAtHash(refreshBody.access_token as string));
      expect(claims.auth_time).toBe(origClaims.auth_time);
      expect(claims.nonce).toBeUndefined();
    });
  });

  describe('allowed_scopes enforcement', () => {
    test('rejects scopes not in client allowed_scopes on authorize', async () => {
      addTestClient(
        createTestClient({
          client_id: 'restricted-client',
          client_name: 'Restricted',
          allowed_scopes: ['subnet:1:miner'],
          redirect_uris: ['http://localhost:3001/callback'],
        }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/v1/oauth/authorize?client_id=restricted-client&redirect_uri=http://localhost:3001/callback&response_type=code&scope=subnet:1:validator',
      });
      expect(res.statusCode).toBe(403);
      expect(res.payload).toContain('not allowed');
    });

    test('allows scopes within client allowed_scopes', async () => {
      addTestClient(
        createTestClient({
          client_id: 'restricted-client-2',
          client_name: 'Restricted 2',
          allowed_scopes: ['subnet:1:miner'],
          redirect_uris: ['http://localhost:3001/callback'],
        }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/v1/oauth/authorize?client_id=restricted-client-2&redirect_uri=http://localhost:3001/callback&response_type=code&scope=subnet:1:miner',
      });
      expect(res.statusCode).toBe(200);
    });

    test('unrestricted client (empty allowed_scopes) allows any scope', async () => {
      // Default test client has allowed_scopes: []
      const res = await app.inject({
        method: 'GET',
        url: `/v1/oauth/authorize?client_id=${TEST_CLIENT_ID}&redirect_uri=http://localhost:3001/callback&response_type=code&scope=subnet:1:validator`,
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
