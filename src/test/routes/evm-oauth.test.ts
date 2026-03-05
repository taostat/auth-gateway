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
  TEST_CLIENT_SECRET,
} from '../helpers/mockDb';
import { createMockApi, MockChainBuilder } from '../helpers/mockSubtensor';

// Setup mocks BEFORE other imports
setupMockDb();

const builder = new MockChainBuilder();
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
import { getTestEvmAddress, signWithTestEvmWallet } from '../helpers/evmSign';
import crypto from 'crypto';
import { verifyToken, verifyIdToken } from '../../crypto/jwt';

const EVM_CLIENT_ID = 'evm-test-client';
const EVM_PUBLIC_CLIENT_ID = 'evm-public-client';

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
  clearTestClients();
  clearTestRefreshTokens();
  clearTestConsumedCodes();

  // Confidential EVM client
  addTestClient(
    createTestClient({
      client_id: EVM_CLIENT_ID,
      client_name: 'EVM Test App',
      allowed_sign_methods: ['evm'],
      allowed_scopes: ['openid'],
      redirect_uris: ['http://localhost:3001/callback'],
    }),
  );

  // Public EVM client (requires PKCE)
  addTestClient(
    createPublicTestClient({
      client_id: EVM_PUBLIC_CLIENT_ID,
      client_name: 'EVM Public App',
      allowed_sign_methods: ['evm'],
      allowed_scopes: ['openid'],
      redirect_uris: ['http://localhost:3001/callback'],
    }),
  );
});

async function getEvmOAuthChallenge(opts: {
  clientId: string;
  redirectUri?: string;
  address?: string;
  scopes?: string[];
  codeChallenge?: string;
}): Promise<{ sessionId: string; nonce: string }> {
  const { createAuthorizeSession } = require('../../db/authorizeSessions');
  const sessionId = await createAuthorizeSession({
    clientId: opts.clientId,
    redirectUri: opts.redirectUri ?? 'http://localhost:3001/callback',
    scopes: opts.scopes ?? [],
    codeChallenge: opts.codeChallenge,
  });
  const res = await browserPost(app, '/v1/oauth/challenge', {
    session_id: sessionId,
    ...(opts.address ? { address: opts.address } : {}),
  });
  expect(res.statusCode).toBe(200);
  const { nonce } = JSON.parse(res.payload);
  return { sessionId, nonce };
}

async function doEvmOAuthFlow(
  clientId: string,
  opts: { scopes?: string[]; codeVerifier?: string; codeChallenge?: string; clientSecret?: string } = {},
) {
  const evmAddress = getTestEvmAddress();
  const scopes = opts.scopes ?? ['openid'];

  const { sessionId, nonce } = await getEvmOAuthChallenge({
    clientId,
    address: evmAddress,
    scopes,
    codeChallenge: opts.codeChallenge,
  });

  const signature = await signWithTestEvmWallet(nonce);

  const callbackRes = await browserPost(app, '/v1/oauth/callback', {
    session_id: sessionId,
    nonce,
    address: evmAddress,
    signature,
  });
  expect(callbackRes.statusCode).toBe(200);
  const { code } = JSON.parse(callbackRes.payload);

  // 4. Token exchange
  const tokenPayload: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: 'http://localhost:3001/callback',
  };
  if (opts.codeVerifier) tokenPayload.code_verifier = opts.codeVerifier;
  if (opts.clientSecret) tokenPayload.client_secret = opts.clientSecret;

  const tokenRes = await app.inject({
    method: 'POST',
    url: '/v1/oauth/token',
    payload: tokenPayload,
  });

  return { tokenRes, code, evmAddress };
}

describe('EVM OAuth Routes', () => {
  const evmAddress = getTestEvmAddress();

  describe('POST /v1/oauth/callback', () => {
    test('rejects sr25519 address for EVM client', async () => {
      const ss58 = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

      const { sessionId, nonce } = await getEvmOAuthChallenge({
        clientId: EVM_CLIENT_ID,
      });

      const { signWithAlice } = require('../helpers/sign');
      const signature = await signWithAlice(nonce);

      const callbackRes = await browserPost(app, '/v1/oauth/callback', {
        session_id: sessionId,
        nonce,
        address: ss58,
        signature,
      });
      expect(callbackRes.statusCode).toBe(400);
      const body = JSON.parse(callbackRes.payload);
      expect(body.message).toContain('evm');
    });
  });

  describe('full OAuth flow (confidential EVM client)', () => {
    test('challenge -> sign -> callback -> token exchange', async () => {
      const { tokenRes, evmAddress: addr } = await doEvmOAuthFlow(EVM_CLIENT_ID, {
        clientSecret: TEST_CLIENT_SECRET,
      });

      expect(tokenRes.statusCode).toBe(200);
      const body = JSON.parse(tokenRes.payload);
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeDefined();
      expect(body.id_token).toBeDefined();
      expect(body.scope).toBe('openid');

      // Verify access token claims
      const claims = verifyToken(body.access_token);
      expect(claims.sub).toBe(addr);
      expect(claims.evm_address).toBe(addr);
      expect(claims.hotkey).toBeNull();
      expect(claims.coldkey).toBeNull();
      expect(claims.client_id).toBe(EVM_CLIENT_ID);

      // Verify ID token claims (aud = client_id, not global audience)
      const idClaims = verifyIdToken(body.id_token, EVM_CLIENT_ID);
      expect(idClaims.evm_address).toBe(addr);
    });
  });

  describe('full OAuth flow (public EVM client with PKCE)', () => {
    test('complete PKCE flow with EVM wallet', async () => {
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
      const { tokenRes } = await doEvmOAuthFlow(EVM_PUBLIC_CLIENT_ID, {
        codeVerifier: verifier,
        codeChallenge: challenge,
      });

      expect(tokenRes.statusCode).toBe(200);
      const body = JSON.parse(tokenRes.payload);
      expect(body.access_token).toBeDefined();
      expect(body.id_token).toBeDefined();
    });
  });

  describe('EVM refresh token', () => {
    test('refresh rotates token without on-chain verification', async () => {
      const { tokenRes } = await doEvmOAuthFlow(EVM_CLIENT_ID, {
        clientSecret: TEST_CLIENT_SECRET,
      });
      const tokens = JSON.parse(tokenRes.payload);

      const refreshRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
          client_id: EVM_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(refreshRes.statusCode).toBe(200);
      const body = JSON.parse(refreshRes.payload);
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeDefined();
      expect(body.refresh_token).not.toBe(tokens.refresh_token);

      // New access token still has EVM claims
      const claims = verifyToken(body.access_token);
      expect(claims.evm_address).toBe(evmAddress);
      expect(claims.hotkey).toBeNull();
      expect(claims.coldkey).toBeNull();
    });

    test('old refresh token is revoked after rotation', async () => {
      const { tokenRes } = await doEvmOAuthFlow(EVM_CLIENT_ID, {
        clientSecret: TEST_CLIENT_SECRET,
      });
      const tokens = JSON.parse(tokenRes.payload);

      // Use refresh token once
      await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
          client_id: EVM_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });

      // Reuse old refresh token — should fail
      const replayRes = await app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: {
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
          client_id: EVM_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        },
      });
      expect(replayRes.statusCode).toBe(401);
    });
  });
});
