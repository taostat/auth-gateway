import { getPool } from './pool';

const SESSION_TTL_SECONDS = 600; // 10 minutes — users may take time choosing a wallet

export interface AuthorizeSession {
  sessionId: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string | null;
  codeChallengeMethod: 'S256' | null;
  oidcNonce: string | null;
  state: string | null;
}

export async function createAuthorizeSession(opts: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge?: string | undefined;
  codeChallengeMethod?: 'S256' | undefined;
  oidcNonce?: string | undefined;
  state?: string | undefined;
}): Promise<string> {
  const pool = getPool();
  const codeChallenge = opts.codeChallenge ?? null;
  const codeChallengeMethod = codeChallenge ? opts.codeChallengeMethod ?? 'S256' : null;
  const { rows } = await pool.query(
    `INSERT INTO authorize_sessions (client_id, redirect_uri, scopes, code_challenge, code_challenge_method, oidc_nonce, state)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING session_id`,
    [
      opts.clientId,
      opts.redirectUri,
      opts.scopes,
      codeChallenge,
      codeChallengeMethod,
      opts.oidcNonce ?? null,
      opts.state ?? null,
    ],
  );
  return rows[0]['session_id'] as string;
}

function mapRow(row: Record<string, unknown>): AuthorizeSession {
  return {
    sessionId: row['session_id'] as string,
    clientId: row['client_id'] as string,
    redirectUri: row['redirect_uri'] as string,
    scopes: (row['scopes'] as string[]) || [],
    codeChallenge: (row['code_challenge'] as string | null) ?? null,
    codeChallengeMethod: (row['code_challenge_method'] as 'S256' | null) ?? null,
    oidcNonce: (row['oidc_nonce'] as string | null) ?? null,
    state: (row['state'] as string | null) ?? null,
  };
}

export async function consumeAuthorizeSession(sessionId: string): Promise<AuthorizeSession | null> {
  const pool = getPool();
  const ttlInterval = `${SESSION_TTL_SECONDS} seconds`;
  const { rows } = await pool.query(
    `UPDATE authorize_sessions SET consumed = TRUE
     WHERE session_id = $1 AND consumed = FALSE AND created_at > now() - $2::interval
     RETURNING session_id, client_id, redirect_uri, scopes, code_challenge, code_challenge_method, oidc_nonce, state`,
    [sessionId, ttlInterval],
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}

export async function getAuthorizeSession(sessionId: string): Promise<AuthorizeSession | null> {
  const pool = getPool();
  const ttlInterval = `${SESSION_TTL_SECONDS} seconds`;
  const { rows } = await pool.query(
    `SELECT session_id, client_id, redirect_uri, scopes, code_challenge, code_challenge_method, oidc_nonce, state
     FROM authorize_sessions
     WHERE session_id = $1 AND consumed = FALSE AND created_at > now() - $2::interval`,
    [sessionId, ttlInterval],
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}

export async function cleanupExpiredAuthorizeSessions(): Promise<void> {
  const pool = getPool();
  const ttlInterval = `${SESSION_TTL_SECONDS} seconds`;
  await pool.query('DELETE FROM authorize_sessions WHERE created_at < now() - $1::interval', [ttlInterval]);
}

let cleanupInterval: NodeJS.Timeout | null = null;
let cleanupPromise: Promise<void> | null = null;

export function startAuthorizeSessionCleanup(intervalMs: number = 60000): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    cleanupPromise = cleanupExpiredAuthorizeSessions().catch((err) => {
      console.error('Authorize session cleanup failed:', err);
    });
  }, intervalMs);
  if (cleanupInterval.unref) cleanupInterval.unref();
}

export function stopAuthorizeSessionCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

export async function waitForAuthorizeSessionCleanup(): Promise<void> {
  if (cleanupPromise) await cleanupPromise;
}
