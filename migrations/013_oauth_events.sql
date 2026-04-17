-- OAuth event log and hourly rollups.
-- For >1k events/sec this table should be partitioned or moved to TimescaleDB.

CREATE TABLE IF NOT EXISTS oauth_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  client_id    text NOT NULL REFERENCES oauth_clients(client_id),
  event_type   text NOT NULL,
  outcome      text NOT NULL,
  error_reason text,
  subject_hash bytea,
  sign_method  text,
  scopes       text[] NOT NULL DEFAULT '{}',
  metadata     jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS oauth_events_client_time_idx ON oauth_events (client_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS oauth_events_type_time_idx  ON oauth_events (event_type, occurred_at DESC);

CREATE TABLE IF NOT EXISTS oauth_events_hourly (
  client_id         text NOT NULL,
  hour_bucket       timestamptz NOT NULL,
  event_type        text NOT NULL,
  outcome           text NOT NULL,
  count             bigint NOT NULL,
  distinct_subjects int NOT NULL,
  PRIMARY KEY (client_id, hour_bucket, event_type, outcome)
);

CREATE INDEX IF NOT EXISTS oauth_events_hourly_time_idx ON oauth_events_hourly (hour_bucket DESC);
