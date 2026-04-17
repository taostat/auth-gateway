import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { getPool } from './pool';
import { OAuthClient } from '../types';
import { BoundedMap } from '../util/boundedMap';
import { scryptVerifyDurationSeconds } from '../metrics/registry';

const invalidStoredOriginsWarned = new Set<string>();

function safeNormalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    if (!invalidStoredOriginsWarned.has(origin)) {
      invalidStoredOriginsWarned.add(origin);
      console.warn(`Invalid stored allowed_origin preserved without normalization: ${origin}`);
    }
    return origin;
  }
}

const CACHE_TTL_MS = 60_000; // 60 seconds
const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

async function scryptAsync(
  secret: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCb(secret, salt, keylen, options, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(derivedKey as Buffer);
    });
  });
}

async function hashClientSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(secret, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

async function verifyScryptSecret(secret: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  if (!nStr || !rStr || !pStr || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, 'base64url');
  const expected = Buffer.from(hashB64, 'base64url');
  const derived = await scryptAsync(secret, salt, expected.length, {
    N: parseInt(nStr, 10),
    r: parseInt(rStr, 10),
    p: parseInt(pStr, 10),
  });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

// In-memory cache: client_id → { client, cachedAt }
const clientCache = new BoundedMap<string, { client: OAuthClient | null; cachedAt: number }>(
  10_000,
  (entry) => Date.now() - entry.cachedAt > CACHE_TTL_MS,
);

interface OAuthClientRow {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string;
  client_type: 'confidential' | 'public';
  redirect_uris: string[] | null;
  grant_types: string[] | null;
  allowed_scopes: string[] | null;
  allowed_origins: string[] | null;
  allowed_sign_methods: string[] | null;
  rate_limit: number;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

function fromRow(row: OAuthClientRow): OAuthClient {
  return {
    client_id: row.client_id,
    ...(row.client_secret_hash ? { client_secret_hash: row.client_secret_hash } : {}),
    client_name: row.client_name,
    client_type: row.client_type,
    redirect_uris: row.redirect_uris || [],
    grant_types: row.grant_types || [],
    allowed_scopes: row.allowed_scopes || [],
    allowed_origins: (row.allowed_origins || []).map(safeNormalizeOrigin),
    allowed_sign_methods: row.allowed_sign_methods || [],
    rate_limit: row.rate_limit,
    active: row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getClientById(clientId: string): Promise<OAuthClient | null> {
  // Check cache
  const cached = clientCache.get(clientId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.client;
  }

  const pool = getPool();
  const { rows } = await pool.query<OAuthClientRow>(
    'SELECT * FROM oauth_clients WHERE client_id = $1 AND active = TRUE',
    [clientId],
  );

  const row = rows[0];
  const client = row ? fromRow(row) : null;
  // Only cache positive results — don't cache null lookups
  if (client) {
    clientCache.set(clientId, { client, cachedAt: Date.now() });
  }
  return client;
}

export async function createClient(opts: {
  client_name: string;
  client_type: 'confidential' | 'public';
  redirect_uris?: string[] | undefined;
  grant_types?: string[] | undefined;
  allowed_scopes?: string[] | undefined;
  allowed_origins?: string[] | undefined;
  allowed_sign_methods?: string[] | undefined;
  rate_limit?: number | undefined;
}): Promise<{ client: OAuthClient; client_secret?: string | undefined }> {
  const pool = getPool();

  let secretHash: string | null = null;
  let plainSecret: string | undefined;

  if (opts.client_type === 'confidential') {
    plainSecret = randomBytes(32).toString('hex');
    secretHash = await hashClientSecret(plainSecret);
  }

  const { rows } = await pool.query<OAuthClientRow>(
    `INSERT INTO oauth_clients (client_secret_hash, client_name, client_type, redirect_uris, grant_types, allowed_scopes, allowed_origins, allowed_sign_methods, rate_limit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      secretHash,
      opts.client_name,
      opts.client_type,
      opts.redirect_uris || [],
      opts.grant_types || ['authorization_code'],
      opts.allowed_scopes || [],
      opts.allowed_origins || [],
      opts.allowed_sign_methods || ['sr25519'],
      opts.rate_limit ?? 60,
    ],
  );

  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create OAuth client');
  }
  const client = fromRow(row);
  // Invalidate cache
  clientCache.delete(client.client_id);

  return { client, client_secret: plainSecret };
}

export async function listClients(): Promise<OAuthClient[]> {
  const pool = getPool();
  const { rows } = await pool.query<OAuthClientRow>(
    'SELECT client_id, client_name, client_type, redirect_uris, grant_types, allowed_scopes, allowed_origins, allowed_sign_methods, rate_limit, active, created_at, updated_at FROM oauth_clients ORDER BY created_at DESC',
  );
  return rows.map(fromRow);
}

export interface UpdateClientFields {
  client_name?: string | undefined;
  redirect_uris?: string[] | undefined;
  grant_types?: string[] | undefined;
  allowed_scopes?: string[] | undefined;
  allowed_origins?: string[] | undefined;
  rate_limit?: number | undefined;
}

const UPDATABLE_COLUMNS: (keyof UpdateClientFields)[] = [
  'client_name',
  'redirect_uris',
  'grant_types',
  'allowed_scopes',
  'allowed_origins',
  'rate_limit',
];

export async function updateClient(clientId: string, fields: UpdateClientFields): Promise<OAuthClient | null> {
  const pool = getPool();

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const col of UPDATABLE_COLUMNS) {
    const value = fields[col];
    if (value !== undefined) {
      setClauses.push(`${col} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

  if (setClauses.length === 0) return null;

  setClauses.push(`updated_at = now()`);
  values.push(clientId);

  const { rows } = await pool.query<OAuthClientRow>(
    `UPDATE oauth_clients SET ${setClauses.join(', ')}
     WHERE client_id = $${paramIndex} AND active = TRUE
     RETURNING *`,
    values,
  );

  const row = rows[0];
  if (!row) return null;

  const client = fromRow(row);
  clientCache.delete(clientId);
  originsCache = null;
  return client;
}

export async function rotateClientSecret(
  clientId: string,
): Promise<{ client: OAuthClient; client_secret: string } | null> {
  const pool = getPool();

  const { rowCount } = await pool.query(
    `SELECT 1 FROM oauth_clients WHERE client_id = $1 AND active = TRUE AND client_type = 'confidential'`,
    [clientId],
  );
  if (!rowCount) return null;

  const plainSecret = randomBytes(32).toString('hex');
  const secretHash = await hashClientSecret(plainSecret);

  const { rows } = await pool.query<OAuthClientRow>(
    `UPDATE oauth_clients
     SET client_secret_hash = $1, updated_at = now()
     WHERE client_id = $2 AND active = TRUE AND client_type = 'confidential'
     RETURNING *`,
    [secretHash, clientId],
  );

  const row = rows[0];
  if (!row) return null;

  const client = fromRow(row);
  clientCache.delete(clientId);
  return { client, client_secret: plainSecret };
}

export async function deactivateClient(clientId: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    'UPDATE oauth_clients SET active = FALSE, updated_at = now() WHERE client_id = $1',
    [clientId],
  );
  // Invalidate cache
  clientCache.delete(clientId);
  originsCache = null;
  return (rowCount ?? 0) > 0;
}

export async function verifyClientSecret(client: OAuthClient, secret: string): Promise<boolean> {
  if (!client.client_secret_hash) return false;
  const start = Date.now();
  const result = await verifyScryptSecret(secret, client.client_secret_hash);
  scryptVerifyDurationSeconds.observe((Date.now() - start) / 1000);
  return result;
}

/** Get all allowed origins from all active clients (for CORS). Cached for 60s. */
let originsCache: { origins: Set<string>; cachedAt: number } | null = null;
interface AllowedOriginsRow {
  allowed_origins: string[] | null;
}

export async function getAllowedOrigins(): Promise<Set<string>> {
  if (originsCache && Date.now() - originsCache.cachedAt < CACHE_TTL_MS) {
    return originsCache.origins;
  }

  const pool = getPool();
  const { rows } = await pool.query<AllowedOriginsRow>('SELECT allowed_origins FROM oauth_clients WHERE active = TRUE');

  const origins = new Set<string>();
  for (const row of rows) {
    for (const origin of row.allowed_origins || []) {
      origins.add(safeNormalizeOrigin(origin));
    }
  }

  originsCache = { origins, cachedAt: Date.now() };
  return origins;
}

export function clearClientCache(): void {
  clientCache.clear();
  originsCache = null;
  invalidStoredOriginsWarned.clear();
}
