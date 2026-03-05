import { v4 as uuidv4 } from 'uuid';
import { getPool } from './pool';
import { config } from '../config';

export interface DbChallenge {
  nonce: string;
  address: string | null;
  scopes: string[];
  createdAt: Date;
}

export async function createChallenge(address: string | null, scopes: string[] = []): Promise<DbChallenge> {
  const pool = getPool();
  const scopesCsv = scopes.length > 0 ? scopes.join(',') : 'none';
  const nonce = `bittensor-auth:${scopesCsv}:${uuidv4()}`;
  const { rows } = await pool.query(
    'INSERT INTO challenges (nonce, address, scopes) VALUES ($1, $2, $3) RETURNING nonce, address, scopes, created_at',
    [nonce, address, scopes],
  );
  const row = rows[0];
  return { nonce: row.nonce, address: row.address, scopes: row.scopes || [], createdAt: row.created_at };
}

export async function consumeChallenge(nonce: string): Promise<DbChallenge> {
  const pool = getPool();
  const ttlInterval = `${config.challengeTtlSeconds} seconds`;
  const { rows } = await pool.query(
    `UPDATE challenges SET consumed = TRUE
     WHERE nonce = $1 AND consumed = FALSE AND created_at > now() - $2::interval
     RETURNING nonce, address, scopes, created_at`,
    [nonce, ttlInterval],
  );
  if (rows.length === 0) {
    throw new Error('challenge_not_found');
  }
  const row = rows[0];
  return { nonce: row.nonce, address: row.address, scopes: row.scopes || [], createdAt: row.created_at };
}

export async function cleanupExpiredChallenges(): Promise<void> {
  const pool = getPool();
  const ttlInterval = `${config.challengeTtlSeconds} seconds`;
  await pool.query('DELETE FROM challenges WHERE created_at < now() - $1::interval', [ttlInterval]);
}

export async function clearChallenges(): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM challenges');
}
