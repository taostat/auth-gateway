import { AuthChallenge, ChallengeBindings } from '../types';
import { ChallengeExpiredError } from '../util/errors';
import { config } from '../config';
import {
  createChallenge as dbCreateChallenge,
  consumeChallenge as dbConsumeChallenge,
  DbChallenge,
  cleanupExpiredChallenges as dbCleanup,
  clearChallenges as dbClear,
} from '../db/challenges';

let cleanupInterval: NodeJS.Timeout | null = null;
let cleanupPromise: Promise<void> | null = null;

function toAuthChallenge(db: DbChallenge): AuthChallenge {
  const createdMs = db.createdAt.getTime();
  return {
    nonce: db.nonce,
    address: db.address,
    scopes: db.scopes,
    createdAt: createdMs,
    expiresAt: createdMs + config.challengeTtlSeconds * 1000,
    flowType: db.flowType,
    clientId: db.clientId,
    redirectUri: db.redirectUri,
    userCode: db.userCode,
    sessionId: db.sessionId,
  };
}

export async function createChallenge(
  address: string | null,
  scopes: string[] = [],
  opts?: ChallengeBindings,
): Promise<AuthChallenge> {
  return toAuthChallenge(await dbCreateChallenge(address, scopes, opts));
}

export async function consumeChallenge(nonce: string): Promise<AuthChallenge> {
  try {
    return toAuthChallenge(await dbConsumeChallenge(nonce));
  } catch {
    throw new ChallengeExpiredError();
  }
}

export function startChallengeCleanup(intervalMs: number = 60000): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    cleanupPromise = dbCleanup().catch((err) => {
      console.error('Challenge cleanup failed:', err);
    });
  }, intervalMs);
  if (cleanupInterval.unref) cleanupInterval.unref();
}

export function stopChallengeCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

export async function waitForChallengeCleanup(): Promise<void> {
  if (cleanupPromise) await cleanupPromise;
}

export async function clearChallenges(): Promise<void> {
  await dbClear();
}
