import type { Pool, PoolClient } from 'pg';
import { getPool } from './pool';
import { RefreshTokenRecord } from '../types';

export const RotateError = {
  NOT_FOUND: 'not_found',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
} as const;

let cleanupInterval: NodeJS.Timeout | null = null;
let cleanupPromise: Promise<void> | null = null;

export async function storeRefreshToken(opts: {
  jti: string;
  client_id: string;
  address: string;
  scopes: string[];
  epoch_at_issuance: number | null;
  expires_at: Date;
}, db: Pool | PoolClient = getPool()): Promise<void> {
  await db.query(
    `INSERT INTO refresh_tokens (jti, client_id, address, scopes, epoch_at_issuance, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [opts.jti, opts.client_id, opts.address, opts.scopes, opts.epoch_at_issuance, opts.expires_at],
  );
}

export async function getRefreshToken(jti: string): Promise<RefreshTokenRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM refresh_tokens WHERE jti = $1', [jti]);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    jti: row.jti,
    client_id: row.client_id,
    address: row.address,
    scopes: row.scopes || [],
    epoch_at_issuance: row.epoch_at_issuance,
    revoked: row.revoked,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

export async function revokeRefreshToken(jti: string): Promise<void> {
  const pool = getPool();
  await pool.query('UPDATE refresh_tokens SET revoked = TRUE WHERE jti = $1', [jti]);
}

export async function rotateRefreshToken(
  oldJti: string,
  newToken: {
    jti: string;
    client_id: string;
    address: string;
    scopes: string[];
    epoch_at_issuance: number | null;
    expires_at: Date;
  },
): Promise<RefreshTokenRecord> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM refresh_tokens WHERE jti = $1 FOR UPDATE', [oldJti]);
    if (rows.length === 0) throw new Error(RotateError.NOT_FOUND);
    const old = rows[0];
    if (old.revoked) throw new Error(RotateError.REVOKED);
    if (new Date() > old.expires_at) throw new Error(RotateError.EXPIRED);

    await client.query(
      'INSERT INTO refresh_tokens (jti, client_id, address, scopes, epoch_at_issuance, expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [
        newToken.jti,
        newToken.client_id,
        newToken.address,
        newToken.scopes,
        newToken.epoch_at_issuance,
        newToken.expires_at,
      ],
    );
    await client.query('UPDATE refresh_tokens SET revoked = TRUE WHERE jti = $1', [oldJti]);
    await client.query('COMMIT');

    return {
      jti: old.jti,
      client_id: old.client_id,
      address: old.address,
      scopes: old.scopes || [],
      epoch_at_issuance: old.epoch_at_issuance,
      revoked: old.revoked,
      expires_at: old.expires_at,
      created_at: old.created_at,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function revokeAllForAddress(clientId: string, address: string): Promise<number> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    'UPDATE refresh_tokens SET revoked = TRUE WHERE client_id = $1 AND address = $2 AND revoked = FALSE',
    [clientId, address],
  );
  return rowCount ?? 0;
}

/**
 * Delete expired and revoked refresh tokens to keep table size bounded.
 */
export async function cleanupRefreshTokens(): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM refresh_tokens WHERE revoked = TRUE OR expires_at < now()');
}

export function startRefreshTokenCleanup(intervalMs: number = 300000): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    cleanupPromise = cleanupRefreshTokens().catch((err) => {
      console.error('Refresh token cleanup failed:', err);
    });
  }, intervalMs);
  if (cleanupInterval.unref) cleanupInterval.unref();
}

export async function waitForRefreshTokenCleanup(): Promise<void> {
  if (cleanupPromise) await cleanupPromise;
}

export function stopRefreshTokenCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
