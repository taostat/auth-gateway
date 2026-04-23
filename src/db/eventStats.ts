import { getPool } from './pool';
import { Window } from '../types';

export interface StatsTotals {
  exchanges: number;
  successes: number;
  failures: number;
  distinct_users: number;
}

export interface StatsTimeseriesPoint {
  bucket: string;
  exchanges: number;
  successes: number;
  failures: number;
  distinct_users: number;
}

export interface ClientStatsResult {
  totals: StatsTotals;
  failures_by_reason: Record<string, number>;
  scopes_requested: Array<{ scope: string; count: number }>;
  timeseries: StatsTimeseriesPoint[];
}

const EXCHANGE_EVENT_TYPES = ['token_exchange', 'token_refresh'];

function windowToInterval(window: Window): string {
  switch (window) {
    case '24h':
      return '24 hours';
    case '7d':
      return '7 days';
    case '30d':
      return '30 days';
  }
}

function useRollup(window: Window): boolean {
  return window === '30d';
}

interface CountTriple {
  exchanges: number;
  successes: number;
  failures: number;
}

function emptyCounts(): CountTriple {
  return { exchanges: 0, successes: 0, failures: 0 };
}

async function totalsFromRaw(clientId: string, window: Window): Promise<StatsTotals> {
  const { rows } = await getPool().query(
    `SELECT
       COUNT(*)::int AS exchanges,
       COUNT(*) FILTER (WHERE outcome = 'success')::int AS successes,
       COUNT(*) FILTER (WHERE outcome = 'failure')::int AS failures,
       COUNT(DISTINCT subject_hash) FILTER (WHERE subject_hash IS NOT NULL)::int AS distinct_users
     FROM oauth_events
     WHERE client_id = $1
       AND event_type = ANY($2::text[])
       AND occurred_at >= now() - $3::interval`,
    [clientId, EXCHANGE_EVENT_TYPES, windowToInterval(window)],
  );
  const row = rows[0] ?? { exchanges: 0, successes: 0, failures: 0, distinct_users: 0 };
  return {
    exchanges: row.exchanges ?? 0,
    successes: row.successes ?? 0,
    failures: row.failures ?? 0,
    distinct_users: row.distinct_users ?? 0,
  };
}

async function rawDistinctUsers(clientId: string, window: Window): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT COUNT(DISTINCT subject_hash)::int AS distinct_users
     FROM oauth_events
     WHERE client_id = $1
       AND event_type = ANY($2::text[])
       AND occurred_at >= now() - $3::interval
       AND subject_hash IS NOT NULL`,
    [clientId, EXCHANGE_EVENT_TYPES, windowToInterval(window)],
  );
  return rows[0]?.distinct_users ?? 0;
}

async function totalsForThirtyDays(clientId: string): Promise<StatsTotals> {
  const [{ rows }, distinct] = await Promise.all([
    getPool().query(
      `WITH combined AS (
         SELECT outcome, count
         FROM oauth_events_hourly
         WHERE client_id = $1
           AND event_type = ANY($2::text[])
           AND hour_bucket >= now() - interval '30 days'
           AND hour_bucket < date_trunc('hour', now())
         UNION ALL
         SELECT outcome, COUNT(*)::bigint AS count
         FROM oauth_events
         WHERE client_id = $1
           AND event_type = ANY($2::text[])
           AND occurred_at >= date_trunc('hour', now())
         GROUP BY outcome
         UNION ALL
         SELECT outcome, COUNT(*)::bigint AS count
         FROM oauth_events
         WHERE client_id = $1
           AND event_type = ANY($2::text[])
           AND occurred_at >= now() - interval '30 days'
           AND occurred_at < date_trunc('hour', now())
           AND NOT EXISTS (
             SELECT 1 FROM oauth_events_hourly h
             WHERE h.client_id = $1
               AND h.hour_bucket = date_trunc('hour', oauth_events.occurred_at)
               AND h.event_type = oauth_events.event_type
               AND h.outcome = oauth_events.outcome
           )
         GROUP BY outcome
       )
       SELECT
         COALESCE(SUM(count), 0)::int AS exchanges,
         COALESCE(SUM(count) FILTER (WHERE outcome = 'success'), 0)::int AS successes,
         COALESCE(SUM(count) FILTER (WHERE outcome = 'failure'), 0)::int AS failures
       FROM combined`,
      [clientId, EXCHANGE_EVENT_TYPES],
    ),
    rawDistinctUsers(clientId, '30d'),
  ]);
  const row = rows[0] ?? { exchanges: 0, successes: 0, failures: 0 };
  return {
    exchanges: row.exchanges ?? 0,
    successes: row.successes ?? 0,
    failures: row.failures ?? 0,
    distinct_users: distinct,
  };
}

async function failuresByReason(clientId: string, window: Window): Promise<Record<string, number>> {
  const { rows } = await getPool().query(
    `SELECT COALESCE(error_reason, 'unknown') AS reason, COUNT(*)::int AS count
     FROM oauth_events
     WHERE client_id = $1
       AND event_type = ANY($2::text[])
       AND outcome = 'failure'
       AND occurred_at >= now() - $3::interval
     GROUP BY reason`,
    [clientId, EXCHANGE_EVENT_TYPES, windowToInterval(window)],
  );
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (row.count > 0) out[row.reason as string] = row.count;
  }
  return out;
}

async function scopesRequested(
  clientId: string,
  window: Window,
): Promise<Array<{ scope: string; count: number }>> {
  // token_exchange fires once per new token grant across all flows (auth code,
  // device code). authorize is skipped because browser flow emits both, and
  // token_refresh is skipped because it carries scopes forward from an existing
  // grant rather than representing a new request.
  const { rows } = await getPool().query(
    `SELECT scope, COUNT(*)::int AS count
     FROM (
       SELECT UNNEST(scopes) AS scope
       FROM oauth_events
       WHERE client_id = $1
         AND event_type = 'token_exchange'
         AND outcome = 'success'
         AND occurred_at >= now() - $2::interval
     ) s
     GROUP BY scope
     ORDER BY count DESC`,
    [clientId, windowToInterval(window)],
  );
  return rows.map((r) => ({ scope: r.scope as string, count: r.count as number }));
}

function mapTimeseriesRow(r: Record<string, unknown>): StatsTimeseriesPoint {
  return {
    bucket: (r['bucket'] as Date).toISOString(),
    exchanges: r['exchanges'] as number,
    successes: r['successes'] as number,
    failures: r['failures'] as number,
    distinct_users: r['distinct_users'] as number,
  };
}

async function timeseriesFromRaw(
  clientId: string,
  window: Window,
): Promise<StatsTimeseriesPoint[]> {
  const { rows } = await getPool().query(
    `SELECT
       date_trunc('hour', occurred_at) AS bucket,
       COUNT(*)::int AS exchanges,
       COUNT(*) FILTER (WHERE outcome = 'success')::int AS successes,
       COUNT(*) FILTER (WHERE outcome = 'failure')::int AS failures,
       COUNT(DISTINCT subject_hash) FILTER (WHERE subject_hash IS NOT NULL)::int AS distinct_users
     FROM oauth_events
     WHERE client_id = $1
       AND event_type = ANY($2::text[])
       AND occurred_at >= now() - $3::interval
     GROUP BY bucket
     ORDER BY bucket ASC`,
    [clientId, EXCHANGE_EVENT_TYPES, windowToInterval(window)],
  );
  return rows.map(mapTimeseriesRow);
}

async function timeseriesForThirtyDays(clientId: string): Promise<StatsTimeseriesPoint[]> {
  const { rows } = await getPool().query(
    `WITH combined AS (
       SELECT date_trunc('day', hour_bucket) AS bucket,
              outcome, count
       FROM oauth_events_hourly
       WHERE client_id = $1
         AND event_type = ANY($2::text[])
         AND hour_bucket >= date_trunc('day', now() - INTERVAL '30 days')
         AND hour_bucket < date_trunc('hour', now())
       UNION ALL
       SELECT date_trunc('day', occurred_at) AS bucket,
              outcome, COUNT(*)::bigint AS count
       FROM oauth_events
       WHERE client_id = $1
         AND event_type = ANY($2::text[])
         AND occurred_at >= date_trunc('hour', now())
       GROUP BY 1, 2
       UNION ALL
       SELECT date_trunc('day', occurred_at) AS bucket,
              outcome, COUNT(*)::bigint AS count
       FROM oauth_events
       WHERE client_id = $1
         AND event_type = ANY($2::text[])
         AND occurred_at >= date_trunc('day', now() - INTERVAL '30 days')
         AND occurred_at < date_trunc('hour', now())
         AND NOT EXISTS (
           SELECT 1 FROM oauth_events_hourly h
           WHERE h.client_id = $1
             AND h.hour_bucket = date_trunc('hour', oauth_events.occurred_at)
             AND h.event_type = oauth_events.event_type
             AND h.outcome = oauth_events.outcome
         )
       GROUP BY 1, 2
     ),
     daily AS (
       SELECT bucket,
              SUM(count)::int AS exchanges,
              SUM(count) FILTER (WHERE outcome = 'success')::int AS successes,
              SUM(count) FILTER (WHERE outcome = 'failure')::int AS failures
       FROM combined
       GROUP BY bucket
     ),
     daily_distinct AS (
       SELECT date_trunc('day', occurred_at) AS bucket,
              COUNT(DISTINCT subject_hash)::int AS distinct_users
       FROM oauth_events
       WHERE client_id = $1
         AND event_type = ANY($2::text[])
         AND occurred_at >= date_trunc('day', now() - INTERVAL '30 days')
         AND subject_hash IS NOT NULL
       GROUP BY bucket
     )
     SELECT d.bucket,
            COALESCE(d.exchanges, 0) AS exchanges,
            COALESCE(d.successes, 0) AS successes,
            COALESCE(d.failures, 0)  AS failures,
            COALESCE(dd.distinct_users, 0) AS distinct_users
     FROM daily d
     LEFT JOIN daily_distinct dd ON dd.bucket = d.bucket
     ORDER BY d.bucket ASC`,
    [clientId, EXCHANGE_EVENT_TYPES],
  );
  return rows.map(mapTimeseriesRow);
}

export async function getClientStats(clientId: string, window: Window): Promise<ClientStatsResult> {
  const isThirty = useRollup(window);
  const [totals, failures, scopes, timeseries] = await Promise.all([
    isThirty ? totalsForThirtyDays(clientId) : totalsFromRaw(clientId, window),
    failuresByReason(clientId, window),
    scopesRequested(clientId, window),
    isThirty ? timeseriesForThirtyDays(clientId) : timeseriesFromRaw(clientId, window),
  ]);
  return { totals, failures_by_reason: failures, scopes_requested: scopes, timeseries };
}

export interface EventRow {
  id: string;
  occurred_at: string;
  event_type: string;
  outcome: string;
  error_reason: string | null;
  sign_method: string | null;
  scopes: string[];
  subject_prefix: string | null;
  metadata: Record<string, unknown>;
}

export interface EventsCursor {
  occurred_at: Date;
  id: string;
}

export async function listClientEvents(
  clientId: string,
  opts: { limit: number; before?: EventsCursor | undefined },
): Promise<EventRow[]> {
  const params: unknown[] = [clientId];
  let query = `SELECT id, occurred_at, event_type, outcome, error_reason, sign_method, scopes, subject_hash, metadata
               FROM oauth_events
               WHERE client_id = $1`;
  if (opts.before) {
    // Composite cursor (occurred_at, id) breaks ties so events sharing a timestamp aren't skipped.
    params.push(opts.before.occurred_at);
    params.push(opts.before.id);
    query += ` AND (occurred_at, id) < ($${params.length - 1}, $${params.length})`;
  }
  params.push(opts.limit);
  query += ` ORDER BY occurred_at DESC, id DESC LIMIT $${params.length}`;

  const { rows } = await getPool().query(query, params);
  return rows.map((r) => ({
    id: r.id as string,
    occurred_at: (r.occurred_at as Date).toISOString(),
    event_type: r.event_type as string,
    outcome: r.outcome as string,
    error_reason: (r.error_reason as string | null) ?? null,
    sign_method: (r.sign_method as string | null) ?? null,
    scopes: (r.scopes as string[]) ?? [],
    // 16 hex chars = 64 bits; collisions expected at ~4 billion subjects (birthday bound)
    subject_prefix: r.subject_hash ? (r.subject_hash as Buffer).toString('hex').slice(0, 16) : null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  }));
}

export interface OverviewByClient {
  client_id: string;
  client_name: string;
  client_type: 'public' | 'confidential';
  active: boolean;
  exchanges: number;
  successes: number;
  failures: number;
  distinct_users: number;
}

function mapOverviewRow(r: Record<string, unknown>): OverviewByClient {
  return {
    client_id: r['client_id'] as string,
    client_name: r['client_name'] as string,
    client_type: r['client_type'] as 'public' | 'confidential',
    active: r['active'] as boolean,
    exchanges: r['exchanges'] as number,
    successes: r['successes'] as number,
    failures: r['failures'] as number,
    distinct_users: r['distinct_users'] as number,
  };
}

async function overviewFromRaw(window: Window): Promise<OverviewByClient[]> {
  const { rows } = await getPool().query(
    `SELECT
       c.client_id,
       c.client_name,
       c.client_type,
       c.active,
       COALESCE(COUNT(e.id), 0)::int AS exchanges,
       COALESCE(COUNT(e.id) FILTER (WHERE e.outcome = 'success'), 0)::int AS successes,
       COALESCE(COUNT(e.id) FILTER (WHERE e.outcome = 'failure'), 0)::int AS failures,
       COALESCE(COUNT(DISTINCT e.subject_hash) FILTER (WHERE e.subject_hash IS NOT NULL), 0)::int AS distinct_users
     FROM oauth_clients c
     LEFT JOIN oauth_events e
       ON e.client_id = c.client_id
       AND e.event_type = ANY($1::text[])
       AND e.occurred_at >= now() - $2::interval
     GROUP BY c.client_id, c.client_name, c.client_type, c.active
     ORDER BY exchanges DESC, c.client_id ASC`,
    [EXCHANGE_EVENT_TYPES, windowToInterval(window)],
  );
  return rows.map(mapOverviewRow);
}

async function overviewForThirtyDays(): Promise<OverviewByClient[]> {
  const { rows } = await getPool().query(
    `WITH combined AS (
       SELECT h.client_id, h.outcome, h.count
       FROM oauth_events_hourly h
       WHERE h.event_type = ANY($1::text[])
         AND h.hour_bucket >= now() - INTERVAL '30 days'
         AND h.hour_bucket < date_trunc('hour', now())
       UNION ALL
       SELECT e.client_id, e.outcome, COUNT(*)::bigint AS count
       FROM oauth_events e
       WHERE e.event_type = ANY($1::text[])
         AND e.occurred_at >= date_trunc('hour', now())
       GROUP BY e.client_id, e.outcome
       UNION ALL
       SELECT e.client_id, e.outcome, COUNT(*)::bigint AS count
       FROM oauth_events e
       WHERE e.event_type = ANY($1::text[])
         AND e.occurred_at >= now() - INTERVAL '30 days'
         AND e.occurred_at < date_trunc('hour', now())
         AND NOT EXISTS (
           SELECT 1 FROM oauth_events_hourly h
           WHERE h.client_id = e.client_id
             AND h.hour_bucket = date_trunc('hour', e.occurred_at)
             AND h.event_type = e.event_type
             AND h.outcome = e.outcome
         )
       GROUP BY e.client_id, e.outcome
     ),
     totals AS (
       SELECT client_id,
              SUM(count)::int AS exchanges,
              SUM(count) FILTER (WHERE outcome = 'success')::int AS successes,
              SUM(count) FILTER (WHERE outcome = 'failure')::int AS failures
       FROM combined
       GROUP BY client_id
     ),
     distinct_users AS (
       SELECT client_id, COUNT(DISTINCT subject_hash)::int AS distinct_users
       FROM oauth_events
       WHERE event_type = ANY($1::text[])
         AND occurred_at >= now() - INTERVAL '30 days'
         AND subject_hash IS NOT NULL
       GROUP BY client_id
     )
     SELECT
       c.client_id,
       c.client_name,
       c.client_type,
       c.active,
       COALESCE(t.exchanges, 0)::int AS exchanges,
       COALESCE(t.successes, 0)::int AS successes,
       COALESCE(t.failures, 0)::int  AS failures,
       COALESCE(du.distinct_users, 0)::int AS distinct_users
     FROM oauth_clients c
     LEFT JOIN totals t          ON t.client_id  = c.client_id
     LEFT JOIN distinct_users du ON du.client_id = c.client_id
     ORDER BY exchanges DESC, c.client_id ASC`,
    [EXCHANGE_EVENT_TYPES],
  );
  return rows.map(mapOverviewRow);
}

async function globalDistinctUsers(window: Window): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT COUNT(DISTINCT subject_hash)::int AS distinct_users
     FROM oauth_events
     WHERE event_type = ANY($1::text[])
       AND occurred_at >= now() - $2::interval
       AND subject_hash IS NOT NULL`,
    [EXCHANGE_EVENT_TYPES, windowToInterval(window)],
  );
  return rows[0]?.distinct_users ?? 0;
}

export async function getOverview(window: Window): Promise<{
  totals: StatsTotals;
  by_client: OverviewByClient[];
}> {
  const [byClient, distinctUsers] = await Promise.all([
    useRollup(window) ? overviewForThirtyDays() : overviewFromRaw(window),
    globalDistinctUsers(window),
  ]);
  const totals: StatsTotals = { exchanges: 0, successes: 0, failures: 0, distinct_users: distinctUsers };
  for (const c of byClient) {
    totals.exchanges += c.exchanges;
    totals.successes += c.successes;
    totals.failures += c.failures;
  }
  return { totals, by_client: byClient };
}
