import type { Pool, PoolClient } from 'pg';
import {
  markAuthCodeConsumed as dbMark,
  isAuthCodeConsumed as dbIsConsumed,
  cleanupConsumedCodes as dbCleanup,
  clearConsumedCodes as dbClear,
} from '../db/consumedAuthCodes';

let cleanupInterval: NodeJS.Timeout | null = null;
let cleanupPromise: Promise<void> | null = null;

export async function markAuthCodeConsumed(
  jti: string,
  db?: Pool | PoolClient,
): Promise<boolean> {
  return dbMark(jti, db);
}

export async function isAuthCodeConsumed(jti: string): Promise<boolean> {
  return dbIsConsumed(jti);
}

export function startAuthCodeCleanup(intervalMs: number = 60000): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    cleanupPromise = dbCleanup().catch((err) => {
      console.error('Auth code cleanup failed:', err);
    });
  }, intervalMs);
  if (cleanupInterval.unref) cleanupInterval.unref();
}

export function stopAuthCodeCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

export async function waitForAuthCodeCleanup(): Promise<void> {
  if (cleanupPromise) await cleanupPromise;
}

export async function clearConsumedCodes(): Promise<void> {
  await dbClear();
}
