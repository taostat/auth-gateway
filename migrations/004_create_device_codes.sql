CREATE TABLE IF NOT EXISTS device_codes (
  device_code TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  scopes TEXT[] NOT NULL DEFAULT '{}',
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  denied BOOLEAN NOT NULL DEFAULT FALSE,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_polled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_device_codes_user_code ON device_codes (user_code);
CREATE INDEX IF NOT EXISTS idx_device_codes_expires ON device_codes (expires_at);
