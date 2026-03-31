ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS flow_type TEXT,
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS redirect_uri TEXT,
  ADD COLUMN IF NOT EXISTS user_code TEXT,
  ADD COLUMN IF NOT EXISTS session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_challenges_flow_type ON challenges (flow_type);
