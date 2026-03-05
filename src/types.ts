export type {
  TokenResponse,
  ChallengeResponse,
  DeviceCodeResponse,
  HealthResponse,
} from './schemas/responses';

export interface AuthChallenge {
  nonce: string;
  address: string | null;
  scopes: string[];
  createdAt: number;
  expiresAt: number;
}

export interface JwtClaims {
  iss: string;
  sub: string;
  aud: string;
  scopes: string[];
  exp: number;
  iat: number;
  jti?: string;
  type?: 'access' | 'refresh' | 'auth_code';
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  epoch?: number;
  hotkey?: string | null;
  coldkey?: string | null;
}

export interface DeviceCodeEntry {
  deviceCode: string;
  userCode: string;
  clientId: string;
  scopes: string[];
  createdAt: Date;
  expiresAt: Date;
  approved: boolean;
  address?: string | null;
  denied: boolean;
  processing?: boolean;
  lastPolledAt?: Date | null;
}

export interface OAuthClient {
  client_id: string;
  client_secret_hash?: string;
  client_name: string;
  client_type: 'confidential' | 'public';
  redirect_uris: string[];
  grant_types: string[];
  allowed_scopes: string[];
  allowed_origins: string[];
  rate_limit: number;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface RefreshTokenRecord {
  jti: string;
  client_id: string;
  address: string;
  scopes: string[];
  epoch_at_issuance: number | null;
  revoked: boolean;
  expires_at: Date;
  created_at: Date;
}
