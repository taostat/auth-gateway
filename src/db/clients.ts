import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { getPool } from './pool';
import { OAuthClient } from '../types';
import { BoundedMap } from '../util/boundedMap';

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
  const [, N, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64url');
  const expected = Buffer.from(hashB64, 'base64url');
  const derived = await scryptAsync(secret, salt, expected.length, {
    N: parseInt(N, 10),
    r: parseInt(r, 10),
    p: parseInt(p, 10),
  });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

// In-memory cache: client_id → { client, cachedAt }
const clientCache = new BoundedMap<string, { client: OAuthClient | null; cachedAt: number }>(
  10_000,
  (entry) => Date.now() - entry.cachedAt > CACHE_TTL_MS,
);

function fromRow(row: any): OAuthClient {
  return {
    client_id: row.client_id,
    client_secret_hash: row.client_secret_hash || undefined,
    client_name: row.client_name,
    client_type: row.client_type,
    redirect_uris: row.redirect_uris || [],
    grant_types: row.grant_types || [],
    allowed_scopes: row.allowed_scopes || [],
    allowed_origins: row.allowed_origins || [],
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
  const { rows } = await pool.query(
    'SELECT * FROM oauth_clients WHERE client_id = $1 AND active = TRUE',
    [clientId],
  );

  const client = rows.length > 0 ? fromRow(rows[0]) : null;
  // Only cache positive results — don't cache null lookups
  if (client) {
    clientCache.set(clientId, { client, cachedAt: Date.now() });
  }
  return client;
}

export async function createClient(opts: {
  client_name: string;
  client_type: 'confidential' | 'public';
  redirect_uris?: string[];
  grant_types?: string[];
  allowed_scopes?: string[];
  allowed_origins?: string[];
  rate_limit?: number;
}): Promise<{ client: OAuthClient; client_secret?: string }> {
  const pool = getPool();

  let secretHash: string | null = null;
  let plainSecret: string | undefined;

  if (opts.client_type === 'confidential') {
    plainSecret = randomBytes(32).toString('hex');
    secretHash = await hashClientSecret(plainSecret);
  }

  const { rows } = await pool.query(
    `INSERT INTO oauth_clients (client_secret_hash, client_name, client_type, redirect_uris, grant_types, allowed_scopes, allowed_origins, rate_limit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      secretHash,
      opts.client_name,
      opts.client_type,
      opts.redirect_uris || [],
      opts.grant_types || ['authorization_code'],
      opts.allowed_scopes || [],
      opts.allowed_origins || [],
      opts.rate_limit ?? 60,
    ],
  );

  const client = fromRow(rows[0]);
  // Invalidate cache
  clientCache.delete(client.client_id);

  return { client, client_secret: plainSecret };
}

export async function listClients(): Promise<OAuthClient[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT client_id, client_name, client_type, redirect_uris, grant_types, allowed_scopes, allowed_origins, rate_limit, active, created_at, updated_at FROM oauth_clients ORDER BY created_at DESC',
  );
  return rows.map(fromRow);
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
  return verifyScryptSecret(secret, client.client_secret_hash);
}

/** Get all allowed origins from all active clients (for CORS). Cached for 60s. */
let originsCache: { origins: Set<string>; cachedAt: number } | null = null;

export async function getAllowedOrigins(): Promise<Set<string>> {
  if (originsCache && Date.now() - originsCache.cachedAt < CACHE_TTL_MS) {
    return originsCache.origins;
  }

  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT allowed_origins FROM oauth_clients WHERE active = TRUE',
  );

  const origins = new Set<string>();
  for (const row of rows) {
    for (const origin of row.allowed_origins || []) {
      origins.add(origin);
    }
  }

  originsCache = { origins, cachedAt: Date.now() };
  return origins;
}

export function clearClientCache(): void {
  clientCache.clear();
  originsCache = null;
}
