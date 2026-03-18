import {
  setupMockDb,
  createTestClient,
  createPublicTestClient,
  addTestClient,
  clearTestClients,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
} from '../helpers/mockDb';

// Setup mocks BEFORE importing modules
setupMockDb();

import { authenticateClient } from '../../middleware/clientAuth';
import { InvalidClientError } from '../../util/errors';

function makeRequest(opts: { body?: Record<string, any>; authorization?: string }) {
  return {
    headers: {
      authorization: opts.authorization,
    },
    body: opts.body || {},
  } as any;
}

beforeEach(() => {
  clearTestClients();
  addTestClient(createTestClient());
  addTestClient(createPublicTestClient());
});

describe('authenticateClient', () => {
  describe('confidential clients', () => {
    test('authenticates via POST body client_id + client_secret', async () => {
      const request = makeRequest({
        body: { client_id: TEST_CLIENT_ID, client_secret: TEST_CLIENT_SECRET },
      });

      const result = await authenticateClient(request);
      expect(result.client.client_id).toBe(TEST_CLIENT_ID);
      expect(result.pkceRequired).toBe(false);
    });

    test('authenticates via Basic auth header', async () => {
      const encoded = Buffer.from(`${TEST_CLIENT_ID}:${TEST_CLIENT_SECRET}`).toString('base64');
      const request = makeRequest({
        authorization: `Basic ${encoded}`,
        body: {},
      });

      const result = await authenticateClient(request);
      expect(result.client.client_id).toBe(TEST_CLIENT_ID);
      expect(result.pkceRequired).toBe(false);
    });

    test('rejects missing client_secret for confidential client', async () => {
      const request = makeRequest({
        body: { client_id: TEST_CLIENT_ID },
      });

      await expect(authenticateClient(request)).rejects.toThrow(InvalidClientError);
    });

    test('rejects wrong client_secret', async () => {
      const request = makeRequest({
        body: { client_id: TEST_CLIENT_ID, client_secret: 'wrong-secret' },
      });

      await expect(authenticateClient(request)).rejects.toThrow(InvalidClientError);
    });
  });

  describe('public clients', () => {
    test('authenticates without secret, flags PKCE required', async () => {
      const request = makeRequest({
        body: { client_id: 'public-test-client' },
      });

      const result = await authenticateClient(request);
      expect(result.client.client_id).toBe('public-test-client');
      expect(result.pkceRequired).toBe(true);
    });
  });

  describe('unknown clients', () => {
    test('rejects unknown client_id', async () => {
      const request = makeRequest({
        body: { client_id: 'nonexistent' },
      });

      await expect(authenticateClient(request)).rejects.toThrow(InvalidClientError);
    });

    test('rejects missing client_id', async () => {
      const request = makeRequest({ body: {} });
      await expect(authenticateClient(request)).rejects.toThrow(InvalidClientError);
    });
  });
});
