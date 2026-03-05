CREATE TABLE IF NOT EXISTS consumed_auth_codes (
  jti TEXT PRIMARY KEY,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consumed_auth_codes_consumed_at ON consumed_auth_codes (consumed_at);
