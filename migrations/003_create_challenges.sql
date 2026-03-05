CREATE TABLE IF NOT EXISTS challenges (
  nonce TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_challenges_created ON challenges (created_at);
