import { createHash } from 'node:crypto';

const poolQuery = jest.fn();

jest.mock('../db/pool', () => ({
  getPool: jest.fn().mockReturnValue({ query: poolQuery }),
}));

import { recordEvent, rollupPreviousHour, cleanupOldEvents } from '../db/events';
import { config } from '../config';

describe('recordEvent', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    (config as { enableEventLog: boolean }).enableEventLog = true;
  });

  test('hashes subject with SHA-256 before insert', async () => {
    await recordEvent({
      client_id: 'c1',
      event_type: 'authorize',
      outcome: 'success',
      subject: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    });

    expect(poolQuery).toHaveBeenCalledTimes(1);
    const args = poolQuery.mock.calls[0]![1] as unknown[];
    const expectedHash = createHash('sha256')
      .update('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY')
      .digest();
    expect(args[4]).toEqual(expectedHash);
  });

  test('passes null subject_hash when subject missing', async () => {
    await recordEvent({ client_id: 'c1', event_type: 'authorize', outcome: 'success' });

    const args = poolQuery.mock.calls[0]![1] as unknown[];
    expect(args[4]).toBeNull();
  });

  test('no-ops when ENABLE_EVENT_LOG is false', async () => {
    (config as { enableEventLog: boolean }).enableEventLog = false;
    try {
      await recordEvent({ client_id: 'c1', event_type: 'authorize', outcome: 'success' });
      expect(poolQuery).not.toHaveBeenCalled();
    } finally {
      (config as { enableEventLog: boolean }).enableEventLog = true;
    }
  });

  test('soft-fails when DB insert throws', async () => {
    poolQuery.mockRejectedValueOnce(new Error('boom'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(
        recordEvent({ client_id: 'c1', event_type: 'authorize', outcome: 'success' }),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test('serializes metadata as JSON and scopes as array', async () => {
    await recordEvent({
      client_id: 'c1',
      event_type: 'authorize',
      outcome: 'success',
      scopes: ['openid', 'subnet:1:miner'],
      metadata: { response_type: 'code' },
    });

    const args = poolQuery.mock.calls[0]![1] as unknown[];
    expect(args[6]).toEqual(['openid', 'subnet:1:miner']);
    expect(args[7]).toBe(JSON.stringify({ response_type: 'code' }));
  });
});

describe('rollup and cleanup', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  test('rollupPreviousHour queries the previous hour window', async () => {
    const now = new Date('2026-04-15T13:37:00.000Z');
    await rollupPreviousHour(now);
    expect(poolQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = poolQuery.mock.calls[0]!;
    expect(sql).toContain('INSERT INTO oauth_events_hourly');
    expect(sql).toContain('ON CONFLICT');
    expect(params[0]).toEqual(new Date('2026-04-15T12:00:00.000Z'));
    expect(params[1]).toEqual(new Date('2026-04-15T13:00:00.000Z'));
  });

  test('cleanupOldEvents deletes events older than retention window', async () => {
    await cleanupOldEvents(7);
    expect(poolQuery).toHaveBeenCalledTimes(2);
    const [sql, params] = poolQuery.mock.calls[0]!;
    expect(sql).toContain('DELETE FROM oauth_events');
    expect(sql).toContain('EXISTS');
    expect(params[0]).toBe(7);
    const [rollupSql] = poolQuery.mock.calls[1]!;
    expect(rollupSql).toContain('DELETE FROM oauth_events_hourly');
    expect(rollupSql).toContain('365 days');
  });
});
