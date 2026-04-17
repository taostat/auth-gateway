import {
  setupMockDb,
  addTestOAuthEvent,
  clearTestOAuthEvents,
  listTestOAuthEvents,
  listTestHourlyBuckets,
  addTestHourlyBucket,
} from './helpers/mockDb';

setupMockDb();

import { config } from '../config';
import { backfillMissingRollups, cleanupOldEvents, rollupHourRange } from '../db/events';

(config as { enableEventLog: boolean }).enableEventLog = true;

describe('mock backfillMissingRollups with partial rollups', () => {
  beforeEach(() => {
    clearTestOAuthEvents();
  });

  test('backfills only the event_type not yet rolled up', async () => {
    const hour = new Date('2026-04-14T10:00:00.000Z');
    const inHour = new Date('2026-04-14T10:30:00.000Z');

    addTestOAuthEvent({
      client_id: 'c1',
      event_type: 'authorize',
      outcome: 'success',
      occurred_at: inHour,
    });
    addTestOAuthEvent({
      client_id: 'c1',
      event_type: 'token_exchange',
      outcome: 'success',
      occurred_at: inHour,
    });

    // Roll up only authorize via rollupHourRange
    await rollupHourRange(hour, new Date(hour.getTime() + 3_600_000));

    const bucketsAfterFirstRollup = listTestHourlyBuckets();
    expect(bucketsAfterFirstRollup).toHaveLength(2);

    // Clear hourly for token_exchange to simulate partial rollup
    const tokenExchangeKey = bucketsAfterFirstRollup.find(
      (b) => b.event_type === 'token_exchange',
    );
    expect(tokenExchangeKey).toBeDefined();

    // Remove token_exchange rollup to create partial state
    clearTestOAuthEvents();
    addTestOAuthEvent({
      client_id: 'c1',
      event_type: 'authorize',
      outcome: 'success',
      occurred_at: inHour,
    });
    addTestOAuthEvent({
      client_id: 'c1',
      event_type: 'token_exchange',
      outcome: 'success',
      occurred_at: inHour,
    });

    // Pre-populate only the authorize rollup
    addTestHourlyBucket({
      client_id: 'c1',
      hour_bucket: hour,
      event_type: 'authorize',
      outcome: 'success',
      count: 1,
      distinct_subjects: 0,
    });

    // Backfill should detect token_exchange is missing
    await backfillMissingRollups();

    const buckets = listTestHourlyBuckets();
    const tokenBucket = buckets.find(
      (b) => b.event_type === 'token_exchange',
    );
    expect(tokenBucket).toBeDefined();
    expect(tokenBucket!.count).toBe(1);
  });

  test('backfill is a no-op when all 4-column keys are covered', async () => {
    const hour = new Date('2026-04-14T08:00:00.000Z');
    const inHour = new Date('2026-04-14T08:15:00.000Z');

    addTestOAuthEvent({
      client_id: 'c1',
      event_type: 'authorize',
      outcome: 'success',
      occurred_at: inHour,
    });

    addTestHourlyBucket({
      client_id: 'c1',
      hour_bucket: hour,
      event_type: 'authorize',
      outcome: 'success',
      count: 1,
      distinct_subjects: 0,
    });

    const bucketsBefore = listTestHourlyBuckets().length;
    await backfillMissingRollups();
    expect(listTestHourlyBuckets()).toHaveLength(bucketsBefore);
  });
});

describe('mock cleanupOldEvents with partial rollups', () => {
  beforeEach(() => {
    clearTestOAuthEvents();
  });

  test('only deletes raw rows whose 4-column key has a rollup', async () => {
    const oldTime = new Date(Date.now() - 40 * 86_400_000);
    const hour = new Date(oldTime);
    hour.setMinutes(0, 0, 0);

    // Two events in the same hour, different event types
    addTestOAuthEvent({
      client_id: 'c1',
      event_type: 'authorize',
      outcome: 'success',
      occurred_at: oldTime,
    });
    addTestOAuthEvent({
      client_id: 'c1',
      event_type: 'token_exchange',
      outcome: 'success',
      occurred_at: oldTime,
    });

    // Only add rollup for authorize — token_exchange has no rollup
    addTestHourlyBucket({
      client_id: 'c1',
      hour_bucket: hour,
      event_type: 'authorize',
      outcome: 'success',
      count: 1,
      distinct_subjects: 0,
    });

    await cleanupOldEvents(30);

    const remaining = listTestOAuthEvents();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.event_type).toBe('token_exchange');
  });

  test('retains all rows when no rollup exists', async () => {
    const oldTime = new Date(Date.now() - 40 * 86_400_000);

    addTestOAuthEvent({
      client_id: 'c1',
      event_type: 'authorize',
      outcome: 'success',
      occurred_at: oldTime,
    });

    await cleanupOldEvents(30);

    expect(listTestOAuthEvents()).toHaveLength(1);
  });
});
