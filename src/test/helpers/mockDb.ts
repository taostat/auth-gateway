import { createHash, randomUUID } from 'node:crypto';
import { OAuthClient, RefreshTokenRecord, Window } from '../../types';

// In-memory mock stores
const clients = new Map<string, OAuthClient>();
const refreshTokens = new Map<string, RefreshTokenRecord>();
const lockedDeviceCodes = new Set<string>();

interface StoredOAuthEvent {
  id: string;
  occurred_at: Date;
  client_id: string;
  event_type: string;
  outcome: string;
  error_reason: string | null;
  subject_hash: Buffer | null;
  sign_method: string | null;
  scopes: string[];
  metadata: Record<string, unknown>;
}

interface StoredHourly {
  client_id: string;
  hour_bucket: Date;
  event_type: string;
  outcome: string;
  count: number;
  distinct_subjects: number;
}

const oauthEvents: StoredOAuthEvent[] = [];
const oauthEventsHourly = new Map<string, StoredHourly>();

const EXCHANGE_TYPES = new Set(['token_exchange', 'token_refresh']);

function totalsFromEvents(events: StoredOAuthEvent[]): {
  exchanges: number;
  successes: number;
  failures: number;
  distinct_users: number;
} {
  const subjects = new Set<string>();
  let successes = 0;
  let failures = 0;
  for (const e of events) {
    if (e.outcome === 'success') successes++;
    else if (e.outcome === 'failure') failures++;
    if (e.subject_hash) subjects.add(e.subject_hash.toString('hex'));
  }
  return {
    exchanges: events.length,
    successes,
    failures,
    distinct_users: subjects.size,
  };
}

function hourlyKey(r: { client_id: string; hour_bucket: Date; event_type: string; outcome: string }): string {
  return `${r.client_id}|${r.hour_bucket.toISOString()}|${r.event_type}|${r.outcome}`;
}

function windowMs(window: Window): number {
  switch (window) {
    case '24h':
      return 24 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return 30 * 24 * 60 * 60 * 1000;
  }
}

function truncToHour(d: Date): Date {
  const out = new Date(d);
  out.setMinutes(0, 0, 0);
  return out;
}

function truncToDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

export function addTestOAuthEvent(input: {
  client_id: string;
  event_type: string;
  outcome: string;
  error_reason?: string | null;
  subject?: string | null;
  sign_method?: string | null;
  scopes?: string[];
  metadata?: Record<string, unknown>;
  occurred_at?: Date;
}): StoredOAuthEvent {
  const ev: StoredOAuthEvent = {
    id: randomUUID(),
    occurred_at: input.occurred_at ?? new Date(),
    client_id: input.client_id,
    event_type: input.event_type,
    outcome: input.outcome,
    error_reason: input.error_reason ?? null,
    subject_hash: input.subject ? createHash('sha256').update(input.subject).digest() : null,
    sign_method: input.sign_method ?? null,
    scopes: input.scopes ?? [],
    metadata: input.metadata ?? {},
  };
  oauthEvents.push(ev);
  return ev;
}

export function addTestHourlyBucket(r: StoredHourly): void {
  oauthEventsHourly.set(hourlyKey(r), r);
}

export function clearTestOAuthEvents(): void {
  oauthEvents.length = 0;
  oauthEventsHourly.clear();
}

export function listTestOAuthEvents(): StoredOAuthEvent[] {
  return [...oauthEvents];
}

export function listTestHourlyBuckets(): StoredHourly[] {
  return Array.from(oauthEventsHourly.values());
}
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

  // Mock db/events
  jest.mock('../../db/events', () => {
    const { config: cfg } = require('../../config');
    return {
      recordEvent: jest.fn().mockImplementation(async (input: Record<string, unknown>) => {
        if (!cfg.enableEventLog) return;
        addTestOAuthEvent({
          client_id: input['client_id'] as string,
          event_type: input['event_type'] as string,
          outcome: input['outcome'] as string,
          error_reason: (input['error_reason'] as string | null | undefined) ?? null,
          subject: (input['subject'] as string | null | undefined) ?? null,
          sign_method: (input['sign_method'] as string | null | undefined) ?? null,
          scopes: (input['scopes'] as string[] | undefined) ?? [],
          metadata: (input['metadata'] as Record<string, unknown> | undefined) ?? {},
        });
      }),
      rollupHourRange: jest.fn().mockImplementation(async (hourStart: Date, hourEnd: Date) => {
        const buckets = new Map<string, { count: number; subjects: Set<string> }>();
        for (const ev of oauthEvents) {
          if (ev.occurred_at >= hourStart && ev.occurred_at < hourEnd) {
            const bucket = truncToHour(ev.occurred_at);
            const key = `${ev.client_id}|${bucket.toISOString()}|${ev.event_type}|${ev.outcome}`;
            let cur = buckets.get(key);
            if (!cur) {
              cur = { count: 0, subjects: new Set() };
              buckets.set(key, cur);
            }
            cur.count++;
            if (ev.subject_hash) cur.subjects.add(ev.subject_hash.toString('hex'));
          }
        }
        for (const [key, val] of buckets) {
          const [client_id, iso, event_type, outcome] = key.split('|');
          addTestHourlyBucket({
            client_id: client_id!,
            hour_bucket: new Date(iso!),
            event_type: event_type!,
            outcome: outcome!,
            count: val.count,
            distinct_subjects: val.subjects.size,
          });
        }
      }),
      rollupPreviousHour: jest.fn().mockImplementation(async (now: Date = new Date()) => {
        const hourEnd = truncToHour(now);
        const hourStart = new Date(hourEnd.getTime() - 60 * 60 * 1000);
        const { rollupHourRange: mockRollup } = require('../../db/events');
        await mockRollup(hourStart, hourEnd);
      }),
      backfillMissingRollups: jest.fn().mockImplementation(async () => {
        const now = new Date();
        const currentHour = truncToHour(now);
        const missingKeys = new Set<string>();
        for (const ev of oauthEvents) {
          if (ev.occurred_at < currentHour) {
            const bucket = truncToHour(ev.occurred_at);
            const key = hourlyKey({
              client_id: ev.client_id,
              hour_bucket: bucket,
              event_type: ev.event_type,
              outcome: ev.outcome,
            });
            if (!oauthEventsHourly.has(key)) {
              missingKeys.add(bucket.toISOString());
            }
          }
        }
        const { rollupHourRange: mockRollup } = require('../../db/events');
        for (const iso of missingKeys) {
          const hourStart = new Date(iso);
          const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);
          await mockRollup(hourStart, hourEnd);
        }
      }),
      cleanupOldEvents: jest.fn().mockImplementation(async (retentionDays: number) => {
        const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        for (let i = oauthEvents.length - 1; i >= 0; i--) {
          const ev = oauthEvents[i]!;
          if (ev.occurred_at.getTime() < cutoff) {
            const bucket = truncToHour(ev.occurred_at);
            const key = hourlyKey({
              client_id: ev.client_id,
              hour_bucket: bucket,
              event_type: ev.event_type,
              outcome: ev.outcome,
            });
            if (oauthEventsHourly.has(key)) {
              oauthEvents.splice(i, 1);
            }
          }
        }
      }),
      startEventLogRollup: jest.fn(),
      stopEventLogRollup: jest.fn(),
      waitForEventLogRollup: jest.fn().mockResolvedValue(undefined),
      startEventLogCleanup: jest.fn(),
      stopEventLogCleanup: jest.fn(),
      waitForEventLogCleanup: jest.fn().mockResolvedValue(undefined),
    };
  });

  // Mock db/eventStats
  jest.mock('../../db/eventStats', () => {
    const exchangesIn = (clientId: string, window: Window): StoredOAuthEvent[] => {
      const cutoff = Date.now() - windowMs(window);
      return oauthEvents.filter(
        (e) =>
          e.client_id === clientId && EXCHANGE_TYPES.has(e.event_type) && e.occurred_at.getTime() >= cutoff,
      );
    };

    return {
      getClientStats: jest.fn().mockImplementation(async (clientId: string, window: Window) => {
        const events = exchangesIn(clientId, window);
        const totals = totalsFromEvents(events);

        const failures_by_reason: Record<string, number> = {};
        for (const e of events) {
          if (e.outcome === 'failure') {
            const reason = e.error_reason ?? 'unknown';
            failures_by_reason[reason] = (failures_by_reason[reason] ?? 0) + 1;
          }
        }

        const scopeCutoff = Date.now() - windowMs(window);
        const scopeCounts = new Map<string, number>();
        for (const e of oauthEvents) {
          if (
            e.client_id === clientId &&
            e.event_type === 'authorize' &&
            e.outcome === 'success' &&
            e.occurred_at.getTime() >= scopeCutoff
          ) {
            for (const s of e.scopes) {
              scopeCounts.set(s, (scopeCounts.get(s) ?? 0) + 1);
            }
          }
        }
        const scopes_requested = Array.from(scopeCounts.entries())
          .map(([scope, count]) => ({ scope, count }))
          .toSorted((a, b) => b.count - a.count);

        const groupBy = window === '30d' ? truncToDay : truncToHour;
        const tsMap = new Map<
          string,
          { bucket: Date; exchanges: number; successes: number; failures: number; subjects: Set<string> }
        >();
        for (const e of events) {
          const bucket = groupBy(e.occurred_at);
          const key = bucket.toISOString();
          let cur = tsMap.get(key);
          if (!cur) {
            cur = { bucket, exchanges: 0, successes: 0, failures: 0, subjects: new Set() };
            tsMap.set(key, cur);
          }
          cur.exchanges++;
          if (e.outcome === 'success') cur.successes++;
          else if (e.outcome === 'failure') cur.failures++;
          if (e.subject_hash) cur.subjects.add(e.subject_hash.toString('hex'));
        }
        const timeseries = Array.from(tsMap.values())
          .toSorted((a, b) => a.bucket.getTime() - b.bucket.getTime())
          .map((b) => ({
            bucket: b.bucket.toISOString(),
            exchanges: b.exchanges,
            successes: b.successes,
            failures: b.failures,
            distinct_users: b.subjects.size,
          }));

        return { totals, failures_by_reason, scopes_requested, timeseries };
      }),
      listClientEvents: jest
        .fn()
        .mockImplementation(
          async (
            clientId: string,
            opts: { limit: number; before?: { occurred_at: Date; id: string } | undefined },
          ) => {
            let filtered = oauthEvents.filter((e) => e.client_id === clientId);
            if (opts.before) {
              const b = opts.before;
              filtered = filtered.filter(
                (e) =>
                  e.occurred_at.getTime() < b.occurred_at.getTime() ||
                  (e.occurred_at.getTime() === b.occurred_at.getTime() && e.id < b.id),
              );
            }
            filtered = filtered.toSorted((a, b) => {
              const delta = b.occurred_at.getTime() - a.occurred_at.getTime();
              if (delta !== 0) return delta;
              return b.id.localeCompare(a.id);
            });
            return filtered.slice(0, opts.limit).map((e) => ({
              id: e.id,
              occurred_at: e.occurred_at.toISOString(),
              event_type: e.event_type,
              outcome: e.outcome,
              error_reason: e.error_reason,
              sign_method: e.sign_method,
              scopes: e.scopes,
              subject_prefix: e.subject_hash ? e.subject_hash.toString('hex').slice(0, 16) : null,
              metadata: e.metadata,
            }));
          },
        ),
      getOverview: jest.fn().mockImplementation(async (window: Window) => {
        const cutoff = Date.now() - windowMs(window);
        const by_client = Array.from(clients.values()).map((c) => {
          const events = exchangesIn(c.client_id, window);
          const t = totalsFromEvents(events);
          return {
            client_id: c.client_id,
            client_name: c.client_name,
            client_type: c.client_type,
            active: c.active,
            exchanges: t.exchanges,
            successes: t.successes,
            failures: t.failures,
            distinct_users: t.distinct_users,
          };
        });
        const by_client_sorted = by_client.toSorted(
          (a, b) => b.exchanges - a.exchanges || a.client_id.localeCompare(b.client_id),
        );
        // Global distinct users: deduplicate across all clients
        const globalSubjects = new Set<string>();
        for (const e of oauthEvents) {
          if (EXCHANGE_TYPES.has(e.event_type) && e.occurred_at.getTime() >= cutoff && e.subject_hash) {
            globalSubjects.add(e.subject_hash.toString('hex'));
          }
        }
        const totals = {
          exchanges: by_client_sorted.reduce((s, c) => s + c.exchanges, 0),
          successes: by_client_sorted.reduce((s, c) => s + c.successes, 0),
          failures: by_client_sorted.reduce((s, c) => s + c.failures, 0),
          distinct_users: globalSubjects.size,
        };
        return { totals, by_client: by_client_sorted };
      }),
    };
  });
}

export function clearTestAuthorizeSessions(): void {
  // Sessions are scoped inside setupMockDb, cleared via jest mock reset
}
