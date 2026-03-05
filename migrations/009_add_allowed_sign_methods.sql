ALTER TABLE oauth_clients
  ADD COLUMN allowed_sign_methods TEXT[] NOT NULL DEFAULT '{}';

UPDATE oauth_clients SET allowed_sign_methods = '{sr25519}';
