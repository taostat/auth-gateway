import { OAuthClient, RefreshTokenRecord } from '../../types';

// In-memory mock stores
const clients = new Map<string, OAuthClient>();
const refreshTokens = new Map<string, RefreshTokenRecord>();
const lockedDeviceCodes = new Set<string>();
const challenges = new Map<
  string,
  {
    nonce: string;
    address: string | null;
    scopes: string[];
    createdAt: Date;
    consumed: boolean;
    flowType: 'auth' | 'oauth' | 'device' | null;
    clientId: string | null;
    redirectUri: string | null;
    userCode: string | null;
    sessionId: string | null;
  }
>();
type MockDeviceCode = {
  deviceCode: string;
  userCode: string;
  clientId: string;
  scopes: string[];
  approved: boolean;
  denied: boolean;
  address: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  lastPolledAt: Date | null;
};

const deviceCodes = new Map<string, MockDeviceCode>();
const consumedAuthCodes = new Set<string>();
type MockRedemptionClient = {
  deviceCode: string;
  pendingRefreshTokens: RefreshTokenRecord[];
  stagedDeviceCode: MockDeviceCode | null;
  stagedDelete: boolean;
  released: boolean;
};

function cloneDeviceCodeEntry(entry: MockDeviceCode): MockDeviceCode {
  return {
    ...entry,
    scopes: [...entry.scopes],
  };
}

// Default test client
export const TEST_CLIENT_ID = 'test-client-id';
export const TEST_CLIENT_SECRET = 'test-client-secret';
export const TEST_CLIENT_SECRET_HASH =
  'scrypt$16384$8$1$3rNi8ChbJg-bLgSRqLga5w$8dizjZp9xLSEyC4FlIdsWt7beV88BY-dXny-ux_8EiYTJCojmn0v8mXgneqZ3RAlASFrkeM6lcKB5ijZ4i2mHQ'; // scrypt hash of 'test-client-secret'

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
    allowed_sign_methods: ['sr25519'],
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
    allowed_sign_methods: ['sr25519'],
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

export function listTestRefreshTokens(): RefreshTokenRecord[] {
  return Array.from(refreshTokens.values());
}

export function clearTestChallenges(): void {
  challenges.clear();
}

export function clearTestDeviceCodes(): void {
  deviceCodes.clear();
  lockedDeviceCodes.clear();
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
    updateClient: jest.fn().mockImplementation(async (clientId: string, fields: Record<string, unknown>) => {
      const client = clients.get(clientId);
      if (!client || !client.active) return null;
      const updated = { ...client, ...fields, updated_at: new Date() };
      // Remove undefined values
      for (const key of Object.keys(updated)) {
        if ((updated as Record<string, unknown>)[key] === undefined) {
          (updated as Record<string, unknown>)[key] = (client as Record<string, unknown>)[key];
        }
      }
      clients.set(clientId, updated as OAuthClient);
      return updated;
    }),
    rotateClientSecret: jest.fn().mockImplementation(async (clientId: string) => {
      const client = clients.get(clientId);
      if (!client || !client.active || client.client_type !== 'confidential') return null;
      const updated = { ...client, client_secret_hash: 'scrypt$new-hash', updated_at: new Date() };
      clients.set(clientId, updated);
      return { client: updated, client_secret: 'new-rotated-secret-hex' };
    }),
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
    storeRefreshToken: jest.fn().mockImplementation(async (opts: any, tx?: any) => {
      const token = {
        jti: opts.jti,
        client_id: opts.client_id,
        address: opts.address,
        scopes: opts.scopes,
        epoch_at_issuance: opts.epoch_at_issuance,
        revoked: false,
        expires_at: opts.expires_at,
        created_at: new Date(),
      };
      // Device code redemption passes a MockRedemptionClient with pendingRefreshTokens
      if (tx && tx.pendingRefreshTokens) {
        tx.pendingRefreshTokens.push(token);
        return;
      }
      // Auth code exchange passes a PoolClient — store directly
      refreshTokens.set(opts.jti, token);
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
      createChallenge: jest.fn().mockImplementation(
        async (
          address: string | null,
          scopes: string[] = [],
          opts?: {
            flowType?: 'auth' | 'oauth' | 'device';
            clientId?: string;
            redirectUri?: string;
            userCode?: string;
            sessionId?: string;
          },
        ) => {
          const scopesCsv = scopes.length > 0 ? scopes.join(',') : 'none';
          const nonce = `taostats-auth:${scopesCsv}:${randomUUID()}`;
          const now = new Date();
          challenges.set(nonce, {
            nonce,
            address,
            scopes,
            createdAt: now,
            consumed: false,
            flowType: opts?.flowType ?? null,
            clientId: opts?.clientId ?? null,
            redirectUri: opts?.redirectUri ?? null,
            userCode: opts?.userCode ?? null,
            sessionId: opts?.sessionId ?? null,
          });
          return {
            nonce,
            address,
            scopes,
            createdAt: now,
            flowType: opts?.flowType ?? null,
            clientId: opts?.clientId ?? null,
            redirectUri: opts?.redirectUri ?? null,
            userCode: opts?.userCode ?? null,
            sessionId: opts?.sessionId ?? null,
          };
        },
      ),
      consumeChallenge: jest.fn().mockImplementation(async (nonce: string) => {
        const challenge = challenges.get(nonce);
        if (!challenge || challenge.consumed) throw new Error('challenge_not_found');
        challenge.consumed = true;
        return {
          nonce: challenge.nonce,
          address: challenge.address,
          scopes: challenge.scopes,
          createdAt: challenge.createdAt,
          flowType: challenge.flowType,
          clientId: challenge.clientId,
          redirectUri: challenge.redirectUri,
          userCode: challenge.userCode,
          sessionId: challenge.sessionId,
        };
      }),
      cleanupExpiredChallenges: jest.fn().mockResolvedValue(undefined),
      clearChallenges: jest.fn().mockImplementation(async () => {
        challenges.clear();
      }),
    };
  });

  // Mock db/deviceCodes
  jest.mock('../../db/deviceCodes', () => ({
    createDeviceCode: jest
      .fn()
      .mockImplementation(
        async (deviceCode: string, userCode: string, clientId: string, scopes: string[], expiresAt: Date) => {
          deviceCodes.set(deviceCode, {
            deviceCode,
            userCode,
            clientId,
            scopes,
            approved: false,
            denied: false,
            address: null,
            approvedAt: null,
            createdAt: new Date(),
            expiresAt,
            lastPolledAt: null,
          });
        },
      ),
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
    beginDeviceCodeRedemption: jest.fn().mockImplementation(async (deviceCode: string) => {
      const entry = deviceCodes.get(deviceCode);
      if (!entry || lockedDeviceCodes.has(deviceCode)) {
        return null;
      }
      lockedDeviceCodes.add(deviceCode);
      return {
        client: {
          deviceCode,
          pendingRefreshTokens: [],
          stagedDeviceCode: cloneDeviceCodeEntry(entry),
          stagedDelete: false,
          released: false,
        },
        entry: cloneDeviceCodeEntry(entry),
      };
    }),
    updateLockedDeviceCodeLastPolledAt: jest
      .fn()
      .mockImplementation(async (client: MockRedemptionClient, deviceCode: string) => {
        if (client.deviceCode === deviceCode && client.stagedDeviceCode && !client.stagedDelete) {
          client.stagedDeviceCode.lastPolledAt = new Date();
        }
      }),
    deleteLockedDeviceCode: jest.fn().mockImplementation(async (client: MockRedemptionClient, deviceCode: string) => {
      if (client.deviceCode === deviceCode) {
        client.stagedDelete = true;
      }
    }),
    commitDeviceCodeRedemption: jest.fn().mockImplementation(async (client: MockRedemptionClient) => {
      for (const token of client.pendingRefreshTokens) {
        refreshTokens.set(token.jti, token);
      }
      if (client.stagedDelete) {
        deviceCodes.delete(client.deviceCode);
      } else if (client.stagedDeviceCode) {
        deviceCodes.set(client.deviceCode, cloneDeviceCodeEntry(client.stagedDeviceCode));
      }
      lockedDeviceCodes.delete(client.deviceCode);
      client.released = true;
    }),
    rollbackDeviceCodeRedemption: jest.fn().mockImplementation(async (client: MockRedemptionClient) => {
      client.pendingRefreshTokens.length = 0;
      client.stagedDeviceCode = null;
      client.stagedDelete = false;
      lockedDeviceCodes.delete(client.deviceCode);
      client.released = true;
    }),
    deleteDeviceCode: jest.fn().mockImplementation(async (deviceCode: string) => {
      deviceCodes.delete(deviceCode);
      lockedDeviceCodes.delete(deviceCode);
    }),
    cleanupExpiredDeviceCodes: jest.fn().mockResolvedValue(undefined),
    clearDeviceCodes: jest.fn().mockImplementation(async () => {
      deviceCodes.clear();
      lockedDeviceCodes.clear();
    }),
  }));

  // Mock db/consumedAuthCodes
  jest.mock('../../db/consumedAuthCodes', () => ({
    markAuthCodeConsumed: jest.fn().mockImplementation(async (jti: string, _db?: unknown) => {
      if (consumedAuthCodes.has(jti)) return false;
      consumedAuthCodes.add(jti);
      return true;
    }),
    isAuthCodeConsumed: jest.fn().mockImplementation(async (jti: string) => {
      return consumedAuthCodes.has(jti);
    }),
    cleanupConsumedCodes: jest.fn().mockResolvedValue(undefined),
    clearConsumedCodes: jest.fn().mockImplementation(async () => {
      consumedAuthCodes.clear();
    }),
  }));

  // Mock db/pool — supports pool.connect() for transaction usage
  jest.mock('../../db/pool', () => ({
    getPool: jest.fn().mockReturnValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: jest.fn().mockImplementation(async () => ({
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: jest.fn(),
      })),
    }),
    disconnectDb: jest.fn().mockResolvedValue(undefined),
  }));

  // Mock db/migrate
  // Mock db/authorizeSessions
  const authorizeSessions = new Map<
    string,
    {
      sessionId: string;
      clientId: string;
      redirectUri: string;
      scopes: string[];
      codeChallenge: string | null;
      codeChallengeMethod: 'S256' | null;
      oidcNonce: string | null;
      state: string | null;
      consumed: boolean;
    }
  >();
  jest.mock('../../db/authorizeSessions', () => {
    const { randomUUID } = require('node:crypto');
    return {
      createAuthorizeSession: jest.fn().mockImplementation(async (opts: Record<string, unknown>) => {
        const sessionId = randomUUID();
        const codeChallenge = (opts['codeChallenge'] as string | null) ?? null;
        authorizeSessions.set(sessionId, {
          sessionId,
          clientId: opts['clientId'] as string,
          redirectUri: opts['redirectUri'] as string,
          scopes: (opts['scopes'] as string[]) || [],
          codeChallenge,
          codeChallengeMethod: codeChallenge ? ((opts['codeChallengeMethod'] as 'S256' | null) ?? 'S256') : null,
          oidcNonce: (opts['oidcNonce'] as string | null) ?? null,
          state: (opts['state'] as string | null) ?? null,
          consumed: false,
        });
        return sessionId;
      }),
      getAuthorizeSession: jest.fn().mockImplementation(async (sessionId: string) => {
        const session = authorizeSessions.get(sessionId);
        if (!session || session.consumed) return null;
        return session;
      }),
      consumeAuthorizeSession: jest.fn().mockImplementation(async (sessionId: string) => {
        const session = authorizeSessions.get(sessionId);
        if (!session || session.consumed) return null;
        session.consumed = true;
        return session;
      }),
      cleanupExpiredAuthorizeSessions: jest.fn().mockResolvedValue(undefined),
    };
  });

  jest.mock('../../db/migrate', () => ({
    runMigrations: jest.fn().mockResolvedValue(undefined),
  }));
}

export function clearTestAuthorizeSessions(): void {
  // Sessions are scoped inside setupMockDb, cleared via jest mock reset
}
