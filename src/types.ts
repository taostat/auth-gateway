export type { TokenResponse, ChallengeResponse, DeviceCodeResponse, HealthResponse } from './schemas/responses';

export type ChallengeFlowType = 'auth' | 'oauth' | 'device';

export interface ChallengeBindings {
  flowType?: ChallengeFlowType | undefined;
  clientId?: string | undefined;
  redirectUri?: string | undefined;
  userCode?: string | undefined;
  sessionId?: string | undefined;
}

export interface AuthChallenge {
  nonce: string;
  address: string | null;
  scopes: string[];
  createdAt: number;
  expiresAt: number;
  flowType: ChallengeFlowType | null;
  clientId: string | null;
  redirectUri: string | null;
  userCode: string | null;
  sessionId: string | null;
}

export interface JwtClaims {
  iss: string;
  sub: string;
  aud: string;
  scope: string;
  exp: number;
  iat: number;
  jti?: string | undefined;
  type?: 'access' | 'refresh' | 'auth_code' | 'id' | undefined;
  client_id?: string | undefined;
  redirect_uri?: string | undefined;
  code_challenge?: string | undefined;
  code_challenge_method?: 'S256' | undefined;
  nonce?: string | undefined;
  at_hash?: string | undefined;
  auth_time?: number | undefined;
  epoch?: number | undefined;
  hotkey?: string | null | undefined;
  coldkey?: string | null | undefined;
  evm_address?: string | null | undefined;
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
  allowed_sign_methods: string[];
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
