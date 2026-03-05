/** RFC 6749 §5.2 OAuth error codes */
export const OAuthErrorCode = {
  INVALID_REQUEST: 'invalid_request',
  INVALID_CLIENT: 'invalid_client',
  INVALID_GRANT: 'invalid_grant',
  UNSUPPORTED_GRANT_TYPE: 'unsupported_grant_type',
  ACCESS_DENIED: 'access_denied',
  EXPIRED_TOKEN: 'expired_token',
  AUTHORIZATION_PENDING: 'authorization_pending',
  SLOW_DOWN: 'slow_down',
} as const;

export class AuthError extends Error {
  public statusCode: number;
  public error: string;

  constructor(message: string, statusCode: number = 401, error: string = 'Unauthorized') {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
    this.error = error;
  }
}

export class ScopeError extends AuthError {
  constructor(scope: string) {
    super(`Scope verification failed: ${scope}`, 403, 'Forbidden');
    this.name = 'ScopeError';
  }
}

export class ChallengeExpiredError extends AuthError {
  constructor() {
    super('Invalid or expired challenge', 401, 'Unauthorized');
    this.name = 'ChallengeExpiredError';
  }
}

export class InvalidSignatureError extends AuthError {
  constructor() {
    super('Invalid signature', 401, 'Unauthorized');
    this.name = 'InvalidSignatureError';
  }
}

export class InvalidAddressError extends AuthError {
  constructor() {
    super('Invalid SS58 address', 400, 'Bad Request');
    this.name = 'InvalidAddressError';
  }
}

export class InvalidScopeFormatError extends AuthError {
  constructor(scope: string) {
    super(`Invalid scope format: ${scope}`, 400, 'Bad Request');
    this.name = 'InvalidScopeFormatError';
  }
}

export class DeviceCodeError extends AuthError {
  constructor(message: string, statusCode: number = 400) {
    super(message, statusCode, statusCode === 404 ? 'Not Found' : 'Bad Request');
    this.name = 'DeviceCodeError';
  }
}

export class InvalidClientError extends AuthError {
  constructor(message: string = 'Invalid client') {
    super(message, 401, OAuthErrorCode.INVALID_CLIENT);
    this.name = 'InvalidClientError';
  }
}

export class InvalidRedirectError extends AuthError {
  constructor(message: string = 'Invalid redirect_uri') {
    super(message, 400, 'invalid_redirect_uri');
    this.name = 'InvalidRedirectError';
  }
}

export class PkceRequiredError extends AuthError {
  constructor() {
    super('PKCE is required for public clients (code_challenge and code_challenge_method=S256)', 400, OAuthErrorCode.INVALID_REQUEST);
    this.name = 'PkceRequiredError';
  }
}

export class AdminAuthError extends AuthError {
  constructor() {
    super('Invalid or missing admin API key', 401, 'Unauthorized');
    this.name = 'AdminAuthError';
  }
}

export class AuthorizationPendingError extends AuthError {
  constructor() {
    super('Authorization pending', 400, OAuthErrorCode.AUTHORIZATION_PENDING);
    this.name = 'AuthorizationPendingError';
  }
}

export class SlowDownError extends AuthError {
  constructor() {
    super('Polling too frequently. Please slow down.', 400, OAuthErrorCode.SLOW_DOWN);
    this.name = 'SlowDownError';
  }
}
