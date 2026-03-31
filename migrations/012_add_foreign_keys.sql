-- Add foreign key constraints for referential integrity.
-- authorize_sessions and challenges reference oauth_clients but lacked FK constraints.
-- ON DELETE SET NULL: allow client deactivation/deletion without blocking cleanup of
-- short-lived rows (challenges TTL 120s, sessions TTL 600s).

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_authorize_sessions_client'
  ) THEN
    ALTER TABLE authorize_sessions
      ADD CONSTRAINT fk_authorize_sessions_client
      FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_challenges_client'
  ) THEN
    ALTER TABLE challenges
      ADD CONSTRAINT fk_challenges_client
      FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id)
      ON DELETE SET NULL;
  END IF;
END $$;
