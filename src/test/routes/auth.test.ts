import { cryptoWaitReady } from '@polkadot/util-crypto';
import {
  setupMockDb,
  clearTestChallenges,
  clearTestClients,
  addTestClient,
  createTestClient,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
  expireTestChallenge,
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

import { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers/app';
import { getAliceAddress, signWithAlice } from '../helpers/sign';
import { getTestEvmAddress, signWithTestEvmWallet } from '../helpers/evmSign';
import { verifyToken } from '../../crypto/jwt';
import { consumeChallenge as consumeDbChallenge, createChallenge as createDbChallenge } from '../../db/challenges';
import { getClientById } from '../../db/clients';
import { getPool } from '../../db/pool';
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
  addTestClient(createTestClient());
});

async function issueAndVerify(
  address: string,
  challengeFields: Record<string, unknown>,
  sign: (nonce: string) => Promise<string> = signWithAlice,
) {
  const challenge = await app.inject({
    method: 'POST',
    url: '/v1/auth/challenge',
    payload: { ...challengeFields, address },
  });
  expect(challenge.statusCode).toBe(200);
  const { nonce } = JSON.parse(challenge.payload) as { nonce: string };
  const verified = await app.inject({
    method: 'POST',
    url: '/v1/auth/verify',
    payload: { nonce, address, signature: await sign(nonce) },
  });
  expect(verified.statusCode).toBe(200);
  const { access_token: accessToken } = JSON.parse(verified.payload) as { access_token: string };
  return { nonce, accessToken, claims: verifyToken(accessToken) };
}

describe('Auth Routes', () => {
  test.each([
    ['challenge', 'deactivation', 400],
    ['verify', 'deactivation', 400],
    ['challenge', 'database failure', 500],
    ['verify', 'database failure', 500],
  ])('bound %s rejects %s even with a warm cache', async (endpoint, failure, status) => {
    const realClients = jest.requireActual<typeof import('../../db/clients')>('../../db/clients');
    realClients.clearClientCache();
    const query = jest.mocked(getPool().query);
    try {
      query.mockResolvedValueOnce({ rows: [createTestClient()], rowCount: 1 } as never);
      await realClients.getClientById(TEST_CLIENT_ID);

      let payload: Record<string, unknown> = {
        address: ALICE,
        client_id: TEST_CLIENT_ID,
        purpose: 'login',
      };
      if (endpoint === 'verify') {
        const challenge = await app.inject({ method: 'POST', url: '/v1/auth/challenge', payload });
        expect(challenge.statusCode).toBe(200);
        const { nonce } = challenge.json();
        payload = { nonce, address: ALICE, signature: await signWithAlice(nonce) };
      }

      if (failure === 'deactivation') {
        // Another process deactivated the client: the active-client query now returns no row.
        query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
      } else {
        query.mockRejectedValueOnce(new Error('database unavailable'));
      }
      jest.mocked(getClientById).mockImplementationOnce(realClients.getClientById);
      const response = await app.inject({ method: 'POST', url: `/v1/auth/${endpoint}`, payload });
      expect(response.statusCode).toBe(status);
      expect(response.json()).not.toHaveProperty('nonce');
      expect(response.json()).not.toHaveProperty('access_token');
    } finally {
      realClients.clearClientCache();
      query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 } as never);
    }
  });

  describe('POST /v1/auth/challenge', () => {
    test('returns nonce for valid address', async () => {
      const address = await getAliceAddress();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.nonce).toMatch(/^taostats-auth:none:[0-9a-f-]{36}$/);
      expect(body.expires_in).toBeGreaterThan(0);
    });

    test('returns 400 for invalid SS58 address', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address: 'not-a-valid-address' },
      });
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 for invalid scope format', async () => {
      const address = await getAliceAddress();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address, scopes: ['invalid-scope'] },
      });
      expect(res.statusCode).toBe(400);
    });

    test('accepts valid scopes', async () => {
      const address = await getAliceAddress();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address, scopes: ['subnet:1:miner'] },
      });
      expect(res.statusCode).toBe(200);
    });

    test('issues a client-bound login challenge with the bound nonce format', async () => {
      const address = await getAliceAddress();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { client_id: TEST_CLIENT_ID, purpose: 'login', address },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).nonce).toMatch(
        new RegExp(`^taostats-auth:login:${TEST_CLIENT_ID}:-:[0-9a-f-]{36}$`),
      );
    });

    const boundFields = {
      client_id: TEST_CLIENT_ID,
      purpose: 'login',
      address: ALICE,
    };

    test.each([
      ['unknown client', { ...boundFields, client_id: 'missing-client' }],
      ['missing purpose', { client_id: boundFields.client_id, address: boundFields.address }],
      ['missing address', { client_id: boundFields.client_id, purpose: boundFields.purpose }],
      ['bad purpose', { ...boundFields, purpose: 'logout' }],
      [
        'context too long',
        {
          ...boundFields,
          context: 'a'.repeat(65),
        },
      ],
      [
        'context has bad characters',
        {
          ...boundFields,
          context: 'bad context',
        },
      ],
      ['empty context', { ...boundFields, context: '' }],
      ['context ends with a newline', { ...boundFields, context: 'invite\n' }],
      ['context contains a delimiter', { ...boundFields, context: 'invite:42' }],
      ['purpose without client', { purpose: 'login', address: boundFields.address }],
      ['context without client', { context: 'invite-1', address: boundFields.address }],
      ['scopes with client', { ...boundFields, scopes: ['openid'] }],
      ['disallowed sign method', { ...boundFields, address: getTestEvmAddress() }],
    ])('returns 400 for %s', async (_label, payload) => {
      const res = await app.inject({ method: 'POST', url: '/v1/auth/challenge', payload });
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 for an inactive client', async () => {
      addTestClient(createTestClient({ active: false }));
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: boundFields,
      });
      expect(res.statusCode).toBe(400);
    });

    test.each(['', 'client:injected', 'client\nname', 'client\n'])(
      'rejects unsafe registered client ID %j',
      async (clientId) => {
        addTestClient(createTestClient({ client_id: clientId }));
        const res = await app.inject({
          method: 'POST',
          url: '/v1/auth/challenge',
          payload: { ...boundFields, client_id: clientId },
        });
        expect(res.statusCode).toBe(400);
      },
    );

    test('rejects an EVM address when allowed_sign_methods is empty', async () => {
      addTestClient(createTestClient({ allowed_sign_methods: [] }));
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { ...boundFields, address: getTestEvmAddress() },
      });
      expect(res.statusCode).toBe(400);
    });

    test.each(['lookup', 'insert'])('returns 500 when challenge %s fails', async (operation) => {
      const failingOperation = operation === 'lookup' ? getClientById : createDbChallenge;
      jest.mocked(failingOperation).mockRejectedValueOnce(new Error('database unavailable'));
      const res = await app.inject({ method: 'POST', url: '/v1/auth/challenge', payload: boundFields });
      expect(res.statusCode).toBe(500);
      expect(res.json()).not.toHaveProperty('nonce');
    });
  });

  describe('POST /v1/auth/verify', () => {
    test('full challenge -> sign -> verify flow (scopeless)', async () => {
      const address = await getAliceAddress();

      // Get challenge
      const challengeRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address },
      });
      const { nonce } = JSON.parse(challengeRes.payload);

      // Sign nonce
      const signature = await signWithAlice(nonce);

      // Verify
      const verifyRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce, address, signature },
      });
      expect(verifyRes.statusCode).toBe(200);
      const body = JSON.parse(verifyRes.payload);
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeUndefined();
      expect(body.token_type).toBe('Bearer');
      expect(body.expires_in).toBeGreaterThan(0);
    });

    test('full flow with scopes (miner)', async () => {
      const address = await getAliceAddress();

      const challengeRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address, scopes: ['subnet:1:miner'] },
      });
      const { nonce } = JSON.parse(challengeRes.payload);
      const signature = await signWithAlice(nonce);

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce, address, signature },
      });
      expect(verifyRes.statusCode).toBe(200);
      const body = JSON.parse(verifyRes.payload);
      expect(body.scope).toBe('subnet:1:miner');
    });

    test('returns 401 for invalid signature', async () => {
      const address = await getAliceAddress();

      const challengeRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address },
      });
      const { nonce } = JSON.parse(challengeRes.payload);

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce, address, signature: '0x' + '00'.repeat(64) },
      });
      expect(verifyRes.statusCode).toBe(401);
    });

    test('returns 401 for expired/missing challenge (replay)', async () => {
      const address = await getAliceAddress();

      const challengeRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address },
      });
      const { nonce } = JSON.parse(challengeRes.payload);
      const signature = await signWithAlice(nonce);

      // First verify succeeds
      await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce, address, signature },
      });

      // Replay attack — reuse same nonce
      const replayRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce, address, signature },
      });
      expect(replayRes.statusCode).toBe(401);
    });

    test('unbound verification omits bound JWT claims', async () => {
      const address = await getAliceAddress();
      const { claims } = await issueAndVerify(address, {});
      expect(claims).not.toHaveProperty('client_id');
      expect(claims).not.toHaveProperty('purpose');
      expect(claims).not.toHaveProperty('context');
    });

    test('bound login claims come from the challenge row', async () => {
      const address = await getAliceAddress();
      const { claims } = await issueAndVerify(address, { client_id: TEST_CLIENT_ID, purpose: 'login' });
      expect(claims.sub).toBe(address);
      expect(claims.hotkey).toBe(address);
      expect(claims.coldkey).toBe(address);
      expect(claims.client_id).toBe(TEST_CLIENT_ID);
      expect(claims.purpose).toBe('login');
      expect(claims).not.toHaveProperty('context');
    });

    test('bound link carries context in its nonce and JWT', async () => {
      const address = await getAliceAddress();
      const { nonce, claims } = await issueAndVerify(address, {
        client_id: TEST_CLIENT_ID,
        purpose: 'link',
        context: 'invite-42',
      });
      expect(nonce).toMatch(new RegExp(`^taostats-auth:link:${TEST_CLIENT_ID}:invite-42:[0-9a-f-]{36}$`));
      expect(claims.client_id).toBe(TEST_CLIENT_ID);
      expect(claims.purpose).toBe('link');
      expect(claims.context).toBe('invite-42');
    });

    test.each(['A._-09', 'a'.repeat(64), '-'])('preserves valid context %j exactly', async (context) => {
      const { nonce, claims } = await issueAndVerify(ALICE, {
        client_id: TEST_CLIENT_ID,
        purpose: 'link',
        context,
      });
      expect(nonce.startsWith(`taostats-auth:link:${TEST_CLIENT_ID}:${context}:`)).toBe(true);
      expect(claims.context).toBe(context);
    });

    test.each([
      ['client', { client_id: 'other-client', purpose: 'login' }],
      ['purpose', { client_id: TEST_CLIENT_ID, purpose: 'link' }],
      ['context', { client_id: TEST_CLIENT_ID, purpose: 'login', context: 'different' }],
      ['unbound flow', {}],
    ])('rejects a bound signature reused for a different %s', async (_label, targetFields) => {
      addTestClient(createTestClient({ client_id: 'other-client' }));
      const source = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address: ALICE, client_id: TEST_CLIENT_ID, purpose: 'login' },
      });
      const target = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address: ALICE, ...targetFields },
      });
      expect(source.statusCode).toBe(200);
      expect(target.statusCode).toBe(200);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce: target.json().nonce, address: ALICE, signature: await signWithAlice(source.json().nonce) },
      });
      expect(res.statusCode).toBe(401);
    });

    test('bound claims ignore extra verify fields and the challenge is single-use under concurrent requests', async () => {
      const challenge = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address: ALICE, client_id: TEST_CLIENT_ID, purpose: 'link', context: 'original' },
      });
      const { nonce } = challenge.json();
      const payload = {
        nonce,
        address: ALICE,
        signature: await signWithAlice(nonce),
        client_id: 'other-client',
        purpose: 'login',
        context: 'replacement',
      };
      const responses = await Promise.all([
        app.inject({ method: 'POST', url: '/v1/auth/verify', payload }),
        app.inject({ method: 'POST', url: '/v1/auth/verify', payload }),
      ]);
      expect(responses.map((res) => res.statusCode).toSorted()).toEqual([200, 401]);
      const success = responses.find((res) => res.statusCode === 200)!;
      expect(verifyToken(success.json().access_token)).toMatchObject({
        client_id: TEST_CLIENT_ID,
        purpose: 'link',
        context: 'original',
      });
    });

    test.each(['login', 'link'])('a bound %s access token cannot be exchanged as an OAuth grant', async (purpose) => {
      const { accessToken } = await issueAndVerify(ALICE, { client_id: TEST_CLIENT_ID, purpose });
      for (const url of ['/v1/oauth/token', '/v1/oauth/refresh']) {
        const res = await app.inject({
          method: 'POST',
          url,
          payload: {
            client_id: TEST_CLIENT_ID,
            client_secret: TEST_CLIENT_SECRET,
            grant_type: url.endsWith('/token') ? 'authorization_code' : 'refresh_token',
            code: accessToken,
            refresh_token: accessToken,
            redirect_uri: 'http://localhost:3001/callback',
          },
        });
        expect(res.statusCode).toBe(401);
        expect(res.json().error).toBe('invalid_grant');
        expect(res.json().message).toContain('Invalid token type');
      }
    });

    test('rejects a bound challenge after the client is deactivated', async () => {
      const address = await getAliceAddress();
      const challenge = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address, client_id: TEST_CLIENT_ID, purpose: 'login' },
      });
      const { nonce } = challenge.json();
      addTestClient(createTestClient({ active: false }));
      const verified = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce, address, signature: await signWithAlice(nonce) },
      });
      expect(verified.statusCode).toBe(400);
      expect(verified.json()).not.toHaveProperty('access_token');
    });

    test('rejects a bound challenge whose client was deleted (ON DELETE SET NULL)', async () => {
      const address = await getAliceAddress();
      const challenge = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { address, client_id: TEST_CLIENT_ID, purpose: 'link' },
      });
      const { nonce } = challenge.json();
      const stored = await consumeDbChallenge(nonce);
      jest.mocked(consumeDbChallenge).mockResolvedValueOnce({ ...stored, clientId: null });
      const verified = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce, address, signature: await signWithAlice(nonce) },
      });
      expect(verified.statusCode).toBe(400);
      expect(verified.json()).not.toHaveProperty('access_token');
    });

    test('allows an EVM address when the client permits EVM signing', async () => {
      addTestClient(createTestClient({ allowed_sign_methods: ['evm'] }));
      const address = getTestEvmAddress();
      const { claims } = await issueAndVerify(
        address,
        { client_id: TEST_CLIENT_ID, purpose: 'login' },
        signWithTestEvmWallet,
      );
      expect(claims.client_id).toBe(TEST_CLIENT_ID);
      expect(claims.purpose).toBe('login');
    });

    test('rejects a signature over a different nonce', async () => {
      const address = await getAliceAddress();
      const challenge = await app.inject({ method: 'POST', url: '/v1/auth/challenge', payload: { address } });
      const { nonce } = JSON.parse(challenge.payload);
      const verified = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce, address, signature: await signWithAlice('different nonce') },
      });
      expect(verified.statusCode).toBe(401);
    });

    test('rejects a bound challenge used with another address', async () => {
      const address = await getAliceAddress();
      const wrongAddress = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
      const challenge = await app.inject({
        method: 'POST',
        url: '/v1/auth/challenge',
        payload: { client_id: TEST_CLIENT_ID, purpose: 'login', address },
      });
      const { nonce } = JSON.parse(challenge.payload);
      const verified = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { nonce, address: wrongAddress, signature: await signWithAlice(nonce) },
      });
      expect(verified.statusCode).toBe(400);
    });

    test.each([{}, { client_id: TEST_CLIENT_ID, purpose: 'login' }])(
      'expired challenges use the existing error response (%j)',
      async (fields) => {
        const address = await getAliceAddress();
        const challenge = await app.inject({
          method: 'POST',
          url: '/v1/auth/challenge',
          payload: { address, ...fields },
        });
        const { nonce } = JSON.parse(challenge.payload);
        expireTestChallenge(nonce);
        const verified = await app.inject({
          method: 'POST',
          url: '/v1/auth/verify',
          payload: { nonce, address, signature: await signWithAlice(nonce) },
        });
        expect(verified.statusCode).toBe(401);
      },
    );
  });
});
