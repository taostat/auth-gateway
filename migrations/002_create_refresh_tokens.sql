CREATE TABLE IF NOT EXISTS refresh_tokens (
    jti               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id         TEXT NOT NULL REFERENCES oauth_clients(client_id),
    address           TEXT NOT NULL,
    scopes            TEXT[] NOT NULL DEFAULT '{}',
    epoch_at_issuance INT,
    revoked           BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at        TIMESTAMPTZ NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_client ON refresh_tokens (client_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens (expires_at) WHERE revoked = FALSE;
