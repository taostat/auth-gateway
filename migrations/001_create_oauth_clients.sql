CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    client_secret_hash TEXT,
    client_name       TEXT NOT NULL,
    client_type       TEXT NOT NULL CHECK (client_type IN ('confidential', 'public')),
    redirect_uris     TEXT[] NOT NULL DEFAULT '{}',
    grant_types       TEXT[] NOT NULL DEFAULT '{authorization_code}',
    allowed_scopes    TEXT[] NOT NULL DEFAULT '{}',
    allowed_origins   TEXT[] NOT NULL DEFAULT '{}',
    rate_limit        INT NOT NULL DEFAULT 60,
    active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
