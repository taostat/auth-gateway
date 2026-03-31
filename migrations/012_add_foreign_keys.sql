-- Add foreign key constraints for referential integrity.
-- authorize_sessions and challenges reference oauth_clients but lacked FK constraints.
--
-- authorize_sessions.client_id is NOT NULL, so use NO ACTION (restrict deletion
-- while active sessions exist — they expire in 10min anyway).
-- challenges.client_id is nullable, so ON DELETE SET NULL is safe.
--
-- NOT VALID skips validation of existing rows during ALTER, avoiding failure on
-- orphaned legacy data. VALIDATE CONSTRAINT then checks asynchronously without
-- holding an ACCESS EXCLUSIVE lock on the referenced table.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_authorize_sessions_client'
  ) THEN
    ALTER TABLE authorize_sessions
      ADD CONSTRAINT fk_authorize_sessions_client
      FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE authorize_sessions
  VALIDATE CONSTRAINT fk_authorize_sessions_client;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_challenges_client'
  ) THEN
    ALTER TABLE challenges
      ADD CONSTRAINT fk_challenges_client
      FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

ALTER TABLE challenges
  VALIDATE CONSTRAINT fk_challenges_client;
