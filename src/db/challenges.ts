import { getPool } from './pool';
import { config } from '../config';
import { buildChallengeNonce } from '../crypto/challengeNonce';
import { AuthPurpose, ChallengeBindings, ChallengeFlowType } from '../types';

export interface DbChallenge {
  nonce: string;
  address: string | null;
  scopes: string[];
  createdAt: Date;
  flowType: ChallengeFlowType | null;
  clientId: string | null;
  purpose: AuthPurpose | null;
  context: string | null;
  redirectUri: string | null;
  userCode: string | null;
  sessionId: string | null;
}

function mapRow(row: Record<string, unknown>): DbChallenge {
  return {
    nonce: row['nonce'] as string,
    address: row['address'] as string | null,
    scopes: (row['scopes'] as string[]) || [],
    createdAt: row['created_at'] as Date,
    flowType: (row['flow_type'] as ChallengeFlowType | null) ?? null,
    clientId: (row['client_id'] as string | null) ?? null,
    purpose: (row['purpose'] as AuthPurpose | null) ?? null,
    context: (row['context'] as string | null) ?? null,
    redirectUri: (row['redirect_uri'] as string | null) ?? null,
    userCode: (row['user_code'] as string | null) ?? null,
    sessionId: (row['session_id'] as string | null) ?? null,
  };
}

export async function createChallenge(
  address: string | null,
  scopes: string[] = [],
  opts?: ChallengeBindings,
): Promise<DbChallenge> {
  const pool = getPool();
  const nonce = buildChallengeNonce(scopes, opts);
  const { rows } = await pool.query(
    `INSERT INTO challenges
       (nonce, address, scopes, flow_type, client_id, purpose, context, redirect_uri, user_code, session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING nonce, address, scopes, created_at, flow_type, client_id, purpose, context,
       redirect_uri, user_code, session_id`,
    [
      nonce,
      address,
      scopes,
      opts?.flowType ?? null,
      opts?.clientId ?? null,
      opts?.purpose ?? null,
      opts?.context ?? null,
      opts?.redirectUri ?? null,
      opts?.userCode ?? null,
      opts?.sessionId ?? null,
    ],
  );
  return mapRow(rows[0]);
}

export async function consumeChallenge(nonce: string): Promise<DbChallenge> {
  const pool = getPool();
  const ttlInterval = `${config.challengeTtlSeconds} seconds`;
  const { rows } = await pool.query(
    `UPDATE challenges SET consumed = TRUE
     WHERE nonce = $1 AND consumed = FALSE AND created_at > now() - $2::interval
     RETURNING nonce, address, scopes, created_at, flow_type, client_id, purpose, context,
       redirect_uri, user_code, session_id`,
    [nonce, ttlInterval],
  );
  if (rows.length === 0) {
    throw new Error('challenge_not_found');
  }
  return mapRow(rows[0]);
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
