import { OAuthClient, RefreshTokenRecord } from '../../types';

// In-memory mock stores
const clients = new Map<string, OAuthClient>();
const refreshTokens = new Map<string, RefreshTokenRecord>();
const challenges = new Map<string, { nonce: string; address: string | null; scopes: string[]; createdAt: Date; consumed: boolean }>();
const deviceCodes = new Map<string, { deviceCode: string; userCode: string; clientId: string; scopes: string[]; approved: boolean; denied: boolean; address: string | null; approvedAt: Date | null; createdAt: Date; expiresAt: Date; lastPolledAt: Date | null }>();
const consumedAuthCodes = new Set<string>();

// Default test client
export const TEST_CLIENT_ID = 'test-client-id';
export const TEST_CLIENT_SECRET = 'test-client-secret';
export const TEST_CLIENT_SECRET_HASH = 'scrypt$16384$8$1$3rNi8ChbJg-bLgSRqLga5w$8dizjZp9xLSEyC4FlIdsWt7beV88BY-dXny-ux_8EiYTJCojmn0v8mXgneqZ3RAlASFrkeM6lcKB5ijZ4i2mHQ'; // scrypt hash of 'test-client-secret'

export function createTestClient(overrides?: Partial<OAuthClient>): OAuthClient {
  return {
    client_id: TEST_CLIENT_ID,
    client_secret_hash: TEST_CLIENT_SECRET_HASH,
    client_name: 'Test App',
    client_type: 'confidential',
    redirect_uris: ['http://localhost:3001/callback'],
    grant_types: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'],
    allowed_scopes: [],
    allowed_origins: ['http://localhost:3001'],
    rate_limit: 60,
    active: true,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

export function createPublicTestClient(overrides?: Partial<OAuthClient>): OAuthClient {
  return {
    client_id: 'public-test-client',
    client_name: 'Public Test App',
    client_type: 'public',
    redirect_uris: ['http://localhost:3001/callback'],
    grant_types: ['authorization_code', 'urn:ietf:params:oauth:grant-type:device_code'],
    allowed_scopes: [],
    allowed_origins: ['http://localhost:3001'],
    rate_limit: 60,
    active: true,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

export function addTestClient(client: OAuthClient): void {
  clients.set(client.client_id, client);
}

export function clearTestClients(): void {
  clients.clear();
}

export function addTestRefreshToken(token: RefreshTokenRecord): void {
  refreshTokens.set(token.jti, token);
}

export function clearTestRefreshTokens(): void {
  refreshTokens.clear();
}

export function getTestRefreshToken(jti: string): RefreshTokenRecord | undefined {
  return refreshTokens.get(jti);
}

export function clearTestChallenges(): void {
  challenges.clear();
}

export function clearTestDeviceCodes(): void {
  deviceCodes.clear();
}

export function clearTestConsumedCodes(): void {
  consumedAuthCodes.clear();
}

/**
 * Setup mock implementations for the DB modules.
 * Call this BEFORE importing modules that use the DB.
 */
export function setupMockDb(): void {
  // Mock db/clients
  jest.mock('../../db/clients', () => ({
    getClientById: jest.fn().mockImplementation(async (clientId: string) => {
      return clients.get(clientId) || null;
    }),
    createClient: jest.fn(),
    listClients: jest.fn().mockImplementation(async () => Array.from(clients.values())),
    deactivateClient: jest.fn().mockImplementation(async (clientId: string) => {
      const existed = clients.has(clientId);
      clients.delete(clientId);
      return existed;
    }),
    verifyClientSecret: jest.fn().mockImplementation(async (client: OAuthClient, secret: string) => {
      if (!client.client_secret_hash) return false;
      return secret === TEST_CLIENT_SECRET;
    }),
    getAllowedOrigins: jest.fn().mockImplementation(async () => {
      const origins = new Set<string>();
      for (const client of clients.values()) {
        for (const origin of client.allowed_origins) {
          origins.add(origin);
        }
      }
      return origins;
    }),
    clearClientCache: jest.fn(),
  }));

  // Mock db/refreshTokens
  jest.mock('../../db/refreshTokens', () => ({
    RotateError: {
      NOT_FOUND: 'not_found',
      REVOKED: 'revoked',
      EXPIRED: 'expired',
    },
    storeRefreshToken: jest.fn().mockImplementation(async (opts: any) => {
      refreshTokens.set(opts.jti, {
        jti: opts.jti,
        client_id: opts.client_id,
        address: opts.address,
        scopes: opts.scopes,
        epoch_at_issuance: opts.epoch_at_issuance,
        revoked: false,
        expires_at: opts.expires_at,
        created_at: new Date(),
      });
    }),
    getRefreshToken: jest.fn().mockImplementation(async (jti: string) => {
      return refreshTokens.get(jti) || null;
    }),
    revokeRefreshToken: jest.fn().mockImplementation(async (jti: string) => {
      const token = refreshTokens.get(jti);
      if (token) token.revoked = true;
    }),
    rotateRefreshToken: jest.fn().mockImplementation(async (oldJti: string, newToken: any) => {
      const old = refreshTokens.get(oldJti);
      if (!old) throw new Error('not_found');
      if (old.revoked) throw new Error('revoked');
      if (new Date() > old.expires_at) throw new Error('expired');
      // Store new
      refreshTokens.set(newToken.jti, {
        jti: newToken.jti,
        client_id: newToken.client_id,
        address: newToken.address,
        scopes: newToken.scopes,
        epoch_at_issuance: newToken.epoch_at_issuance,
        revoked: false,
        expires_at: newToken.expires_at,
        created_at: new Date(),
      });
      // Revoke old
      old.revoked = true;
      return { ...old, revoked: false }; // return state before revocation
    }),
    revokeAllForAddress: jest.fn().mockImplementation(async (clientId: string, address: string) => {
      let count = 0;
      for (const token of refreshTokens.values()) {
        if (token.client_id === clientId && token.address === address && !token.revoked) {
          token.revoked = true;
          count++;
        }
      }
      return count;
    }),
  }));

  // Mock db/challenges
  jest.mock('../../db/challenges', () => {
    const { randomUUID } = require('node:crypto');
    return {
      createChallenge: jest.fn().mockImplementation(async (address: string | null, scopes: string[] = []) => {
        const scopesCsv = scopes.length > 0 ? scopes.join(',') : 'none';
        const nonce = `bittensor-auth:${scopesCsv}:${randomUUID()}`;
        const now = new Date();
        challenges.set(nonce, { nonce, address, scopes, createdAt: now, consumed: false });
        return { nonce, address, scopes, createdAt: now };
      }),
      consumeChallenge: jest.fn().mockImplementation(async (nonce: string) => {
        const challenge = challenges.get(nonce);
        if (!challenge || challenge.consumed) throw new Error('challenge_not_found');
        challenge.consumed = true;
        return { nonce: challenge.nonce, address: challenge.address, scopes: challenge.scopes, createdAt: challenge.createdAt };
      }),
      cleanupExpiredChallenges: jest.fn().mockResolvedValue(undefined),
      clearChallenges: jest.fn().mockImplementation(async () => { challenges.clear(); }),
    };
  });

  // Mock db/deviceCodes
  jest.mock('../../db/deviceCodes', () => ({
    createDeviceCode: jest.fn().mockImplementation(async (deviceCode: string, userCode: string, clientId: string, scopes: string[], expiresAt: Date) => {
      deviceCodes.set(deviceCode, {
        deviceCode, userCode, clientId, scopes,
        approved: false, denied: false, address: null, approvedAt: null,
        createdAt: new Date(), expiresAt, lastPolledAt: null,
      });
    }),
    getDeviceCode: jest.fn().mockImplementation(async (deviceCode: string) => {
      return deviceCodes.get(deviceCode) || null;
    }),
    getDeviceCodeByUserCode: jest.fn().mockImplementation(async (userCode: string) => {
      for (const entry of deviceCodes.values()) {
        if (entry.userCode === userCode && !entry.approved && !entry.denied && new Date() <= entry.expiresAt) {
          return entry;
        }
      }
      return null;
    }),
    approveDeviceCode: jest.fn().mockImplementation(async (userCode: string, address: string) => {
      for (const entry of deviceCodes.values()) {
        if (entry.userCode === userCode && !entry.approved && !entry.denied) {
          entry.approved = true;
          entry.address = address;
          entry.approvedAt = new Date();
          return true;
        }
      }
      return false;
    }),
    denyDeviceCode: jest.fn().mockImplementation(async (userCode: string) => {
      for (const entry of deviceCodes.values()) {
        if (entry.userCode === userCode && !entry.approved && !entry.denied) {
          entry.denied = true;
          return true;
        }
      }
      return false;
    }),
    updateLastPolledAt: jest.fn().mockImplementation(async (deviceCode: string) => {
      const entry = deviceCodes.get(deviceCode);
      if (entry) entry.lastPolledAt = new Date();
    }),
    deleteDeviceCode: jest.fn().mockImplementation(async (deviceCode: string) => {
      deviceCodes.delete(deviceCode);
    }),
    cleanupExpiredDeviceCodes: jest.fn().mockResolvedValue(undefined),
    clearDeviceCodes: jest.fn().mockImplementation(async () => { deviceCodes.clear(); }),
  }));

  // Mock db/consumedAuthCodes
  jest.mock('../../db/consumedAuthCodes', () => ({
    markAuthCodeConsumed: jest.fn().mockImplementation(async (jti: string) => {
      if (consumedAuthCodes.has(jti)) return false;
      consumedAuthCodes.add(jti);
      return true;
    }),
    isAuthCodeConsumed: jest.fn().mockImplementation(async (jti: string) => {
      return consumedAuthCodes.has(jti);
    }),
    cleanupConsumedCodes: jest.fn().mockResolvedValue(undefined),
    clearConsumedCodes: jest.fn().mockImplementation(async () => { consumedAuthCodes.clear(); }),
  }));

  // Mock db/pool
  jest.mock('../../db/pool', () => ({
    getPool: jest.fn().mockReturnValue({}),
    disconnectDb: jest.fn().mockResolvedValue(undefined),
  }));

  // Mock db/migrate
  jest.mock('../../db/migrate', () => ({
    runMigrations: jest.fn().mockResolvedValue(undefined),
  }));
}
