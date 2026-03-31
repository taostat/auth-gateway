-- Add foreign key constraints for referential integrity
-- These columns already reference oauth_clients but lacked FK constraints

ALTER TABLE authorize_sessions
  ADD CONSTRAINT fk_authorize_sessions_client
  FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id);

ALTER TABLE challenges
  ADD CONSTRAINT fk_challenges_client
  FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id);
