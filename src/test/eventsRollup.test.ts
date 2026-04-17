const poolQuery = jest.fn();

jest.mock('../db/pool', () => ({
  getPool: jest.fn().mockReturnValue({ query: poolQuery }),
}));

import { rollupPreviousHour, rollupHourRange, backfillMissingRollups, cleanupOldEvents } from '../db/events';

describe('event log rollup', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  test('rollupPreviousHour uses ON CONFLICT for idempotency', async () => {
    await rollupPreviousHour(new Date('2026-04-15T05:30:00.000Z'));
    await rollupPreviousHour(new Date('2026-04-15T05:30:00.000Z'));

    expect(poolQuery).toHaveBeenCalledTimes(2);
    const [sqlA, paramsA] = poolQuery.mock.calls[0]!;
    const [sqlB, paramsB] = poolQuery.mock.calls[1]!;
    expect(sqlA).toContain('ON CONFLICT (client_id, hour_bucket, event_type, outcome)');
    expect(sqlA).toContain('DO UPDATE SET count = EXCLUDED.count');
    expect(sqlB).toBe(sqlA);
    expect(paramsA).toEqual(paramsB);
  });

  test('rollupPreviousHour aggregates the preceding hour window only', async () => {
    await rollupPreviousHour(new Date('2026-04-15T12:59:59.000Z'));
    const [, params] = poolQuery.mock.calls[0]!;
    expect(params[0]).toEqual(new Date('2026-04-15T11:00:00.000Z'));
    expect(params[1]).toEqual(new Date('2026-04-15T12:00:00.000Z'));
  });

  test('rollupHourRange uses same idempotent SQL as rollupPreviousHour', async () => {
    const start = new Date('2026-04-15T08:00:00.000Z');
    const end = new Date('2026-04-15T09:00:00.000Z');
    await rollupHourRange(start, end);

    expect(poolQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = poolQuery.mock.calls[0]!;
    expect(sql).toContain('ON CONFLICT');
    expect(params[0]).toEqual(start);
    expect(params[1]).toEqual(end);
  });
});

describe('backfillMissingRollups', () => {
  beforeEach(() => {
    poolQuery.mockReset();
  });

  test('rolls up all hours with raw events but no rollup rows', async () => {
    // First call: the SELECT query returning missing hour buckets
    poolQuery.mockResolvedValueOnce({
      rows: [
        { hour_bucket: new Date('2026-04-15T02:00:00.000Z') },
        { hour_bucket: new Date('2026-04-15T04:00:00.000Z') },
        { hour_bucket: new Date('2026-04-15T06:00:00.000Z') },
      ],
      rowCount: 3,
    });
    // Subsequent calls: the INSERT rollup queries
    poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    await backfillMissingRollups();

    // 1 SELECT + 3 rollup INSERTs
    expect(poolQuery).toHaveBeenCalledTimes(4);

    // Verify SELECT query
    const [selectSql] = poolQuery.mock.calls[0]!;
    expect(selectSql).toContain('NOT EXISTS');
    expect(selectSql).toContain('oauth_events_hourly');
    expect(selectSql).toContain('LIMIT 720');

    // Verify each rollup call has correct hour range
    const rollupCalls = poolQuery.mock.calls.slice(1);
    expect(rollupCalls[0]![1]).toEqual([
      new Date('2026-04-15T02:00:00.000Z'),
      new Date('2026-04-15T03:00:00.000Z'),
    ]);
    expect(rollupCalls[1]![1]).toEqual([
      new Date('2026-04-15T04:00:00.000Z'),
      new Date('2026-04-15T05:00:00.000Z'),
    ]);
    expect(rollupCalls[2]![1]).toEqual([
      new Date('2026-04-15T06:00:00.000Z'),
      new Date('2026-04-15T07:00:00.000Z'),
    ]);
  });

  test('does nothing when no missing hours exist', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await backfillMissingRollups();

    expect(poolQuery).toHaveBeenCalledTimes(1);
  });
});

describe('event log cleanup', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  test('cleanupOldEvents passes retention days parameter and cleans up rollups', async () => {
    await cleanupOldEvents(30);
    expect(poolQuery).toHaveBeenCalledTimes(2);
    const [sql, params] = poolQuery.mock.calls[0]!;
    expect(sql).toContain('DELETE FROM oauth_events');
    expect(sql).toContain("INTERVAL '1 day'");
    expect(sql).toContain('EXISTS');
    expect(params[0]).toBe(30);
    const [rollupSql] = poolQuery.mock.calls[1]!;
    expect(rollupSql).toContain('DELETE FROM oauth_events_hourly');
    expect(rollupSql).toContain('365 days');
  });
});
