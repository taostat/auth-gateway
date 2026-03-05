import { AuthChallenge } from '../types';
import { ChallengeExpiredError } from '../util/errors';
import { config } from '../config';
import {
  createChallenge as dbCreateChallenge,
  consumeChallenge as dbConsumeChallenge,
  cleanupExpiredChallenges as dbCleanup,
  clearChallenges as dbClear,
} from '../db/challenges';

let cleanupInterval: NodeJS.Timeout | null = null;
let cleanupPromise: Promise<void> | null = null;

export async function createChallenge(address: string | null, scopes: string[] = []): Promise<AuthChallenge> {
  const dbChallenge = await dbCreateChallenge(address, scopes);
  return {
    nonce: dbChallenge.nonce,
    address: dbChallenge.address,
    scopes: dbChallenge.scopes,
    createdAt: dbChallenge.createdAt.getTime(),
    expiresAt: dbChallenge.createdAt.getTime() + config.challengeTtlSeconds * 1000, // filled by caller context
  };
}

export async function consumeChallenge(nonce: string): Promise<AuthChallenge> {
  try {
    const dbChallenge = await dbConsumeChallenge(nonce);
    return {
      nonce: dbChallenge.nonce,
      address: dbChallenge.address,
      scopes: dbChallenge.scopes,
      createdAt: dbChallenge.createdAt.getTime(),
      expiresAt: dbChallenge.createdAt.getTime() + config.challengeTtlSeconds * 1000,
    };
  } catch {
    throw new ChallengeExpiredError();
  }
}

export function startChallengeCleanup(intervalMs: number = 60000): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => { cleanupPromise = dbCleanup().catch((err) => { console.error('Challenge cleanup failed:', err); }); }, intervalMs);
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
