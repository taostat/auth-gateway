CREATE TABLE IF NOT EXISTS authorize_sessions (
  session_id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  code_challenge TEXT,
  code_challenge_method TEXT,
  oidc_nonce TEXT,
  state TEXT,
  consumed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE authorize_sessions
  ADD COLUMN IF NOT EXISTS code_challenge_method TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'authorize_sessions_pkce_consistency'
  ) THEN
    ALTER TABLE authorize_sessions
      ADD CONSTRAINT authorize_sessions_pkce_consistency CHECK (
        (code_challenge IS NULL AND code_challenge_method IS NULL)
        OR (code_challenge IS NOT NULL AND code_challenge_method = 'S256')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_authorize_sessions_created_at ON authorize_sessions (created_at);
