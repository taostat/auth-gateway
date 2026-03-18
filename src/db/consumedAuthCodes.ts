import { getPool } from './pool';
import { config } from '../config';

/**
 * Mark an auth code JTI as consumed. Returns true if this was the first
 * consumption (inserted), false if already consumed (conflict).
 */
export async function markAuthCodeConsumed(jti: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query('INSERT INTO consumed_auth_codes (jti) VALUES ($1) ON CONFLICT DO NOTHING', [
    jti,
  ]);
  return (rowCount ?? 0) > 0;
}

export async function isAuthCodeConsumed(jti: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT 1 FROM consumed_auth_codes WHERE jti = $1', [jti]);
  return rows.length > 0;
}

export async function cleanupConsumedCodes(): Promise<void> {
  const pool = getPool();
  const retentionInterval = `${config.jwtAuthCodeExpiry * 2} seconds`;
  await pool.query('DELETE FROM consumed_auth_codes WHERE consumed_at < now() - $1::interval', [retentionInterval]);
}

export async function clearConsumedCodes(): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM consumed_auth_codes');
}
