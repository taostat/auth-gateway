import { createHash } from 'node:crypto';
import { getPool } from './pool';
import { config } from '../config';
import { EventType, Outcome } from '../types';
import { SignMethod } from '../crypto/address';

export interface RecordEventInput {
  client_id: string;
  event_type: EventType;
  outcome: Outcome;
  error_reason?: string | null;
  subject?: string | null;
  sign_method?: SignMethod | null;
  scopes?: string[];
  metadata?: Record<string, unknown>;
}

function hashSubject(subject: string): Buffer {
  return createHash('sha256').update(subject).digest();
}

export async function recordEvent(input: RecordEventInput): Promise<void> {
  if (!config.enableEventLog) return;

  const subjectHash = input.subject ? hashSubject(input.subject) : null;

  try {
    await getPool().query(
      `INSERT INTO oauth_events
         (client_id, event_type, outcome, error_reason, subject_hash, sign_method, scopes, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.client_id,
        input.event_type,
        input.outcome,
        input.error_reason ?? null,
        subjectHash,
        input.sign_method ?? null,
        input.scopes ?? [],
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  } catch (err) {
    console.warn('Event log insert failed:', (err as Error).message);
  }
}

let rollupInterval: NodeJS.Timeout | null = null;
let rollupPromise: Promise<void> | null = null;
let cleanupInterval: NodeJS.Timeout | null = null;
let cleanupPromise: Promise<void> | null = null;

export async function rollupHourRange(
  hourStart: Date,
  hourEnd: Date,
): Promise<void> {
  await getPool().query(
    `INSERT INTO oauth_events_hourly (client_id, hour_bucket, event_type, outcome, count, distinct_subjects)
     SELECT
       client_id,
       date_trunc('hour', occurred_at) AS hour_bucket,
       event_type,
       outcome,
       COUNT(*)::bigint AS count,
       COUNT(DISTINCT subject_hash) FILTER (WHERE subject_hash IS NOT NULL)::int AS distinct_subjects
     FROM oauth_events
     WHERE occurred_at >= $1 AND occurred_at < $2
     GROUP BY client_id, date_trunc('hour', occurred_at), event_type, outcome
     ON CONFLICT (client_id, hour_bucket, event_type, outcome)
     DO UPDATE SET count = EXCLUDED.count, distinct_subjects = EXCLUDED.distinct_subjects`,
    [hourStart, hourEnd],
  );
}

export async function rollupPreviousHour(now: Date = new Date()): Promise<void> {
  const hourEnd = new Date(now);
  hourEnd.setMinutes(0, 0, 0);
  const hourStart = new Date(hourEnd.getTime() - 60 * 60 * 1000);
  await rollupHourRange(hourStart, hourEnd);
}

export async function backfillMissingRollups(): Promise<void> {
  const { rows } = await getPool().query(
    `SELECT date_trunc('hour', occurred_at) AS hour_bucket
     FROM oauth_events
     WHERE occurred_at < date_trunc('hour', now())
       AND NOT EXISTS (
         SELECT 1 FROM oauth_events_hourly h
         WHERE h.client_id = oauth_events.client_id
           AND h.hour_bucket = date_trunc('hour', oauth_events.occurred_at)
           AND h.event_type = oauth_events.event_type
           AND h.outcome = oauth_events.outcome
       )
     GROUP BY 1
     ORDER BY 1
     LIMIT 720`,
  );

  for (const row of rows) {
    const hourStart = new Date(row.hour_bucket as Date);
    const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);
    await rollupHourRange(hourStart, hourEnd);
  }
}

export async function cleanupOldEvents(
  retentionDays: number = config.eventLogRetentionDays,
): Promise<void> {
  await getPool().query(
    `DELETE FROM oauth_events
     WHERE occurred_at < now() - ($1::int * INTERVAL '1 day')
       AND EXISTS (
         SELECT 1 FROM oauth_events_hourly h
         WHERE h.client_id = oauth_events.client_id
           AND h.hour_bucket = date_trunc('hour', oauth_events.occurred_at)
           AND h.event_type = oauth_events.event_type
           AND h.outcome = oauth_events.outcome
       )`,
    [retentionDays],
  );
  await getPool().query(
    `DELETE FROM oauth_events_hourly
     WHERE hour_bucket < now() - interval '365 days'`,
  );
}

export function startEventLogRollup(intervalMs: number = 60 * 60 * 1000): void {
  if (rollupInterval) return;
  rollupInterval = setInterval(() => {
    rollupPromise = rollupPreviousHour().catch((err) => {
      console.error('Event log rollup failed:', err);
    });
  }, intervalMs);
  if (rollupInterval.unref) rollupInterval.unref();
}

export function stopEventLogRollup(): void {
  if (rollupInterval) {
    clearInterval(rollupInterval);
    rollupInterval = null;
  }
}

export async function waitForEventLogRollup(): Promise<void> {
  if (rollupPromise) await rollupPromise;
}

export function startEventLogCleanup(intervalMs: number = 24 * 60 * 60 * 1000): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    cleanupPromise = cleanupOldEvents().catch((err) => {
      console.error('Event log cleanup failed:', err);
    });
  }, intervalMs);
  if (cleanupInterval.unref) cleanupInterval.unref();
}

export function stopEventLogCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

export async function waitForEventLogCleanup(): Promise<void> {
  if (cleanupPromise) await cleanupPromise;
}
