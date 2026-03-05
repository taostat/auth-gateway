import crypto from 'crypto';

/**
 * Generate an S256 code challenge from a code verifier (RFC 7636).
 */
export function generateS256Challenge(codeVerifier: string): string {
  return crypto
    .createHash('sha256')
    .update(codeVerifier, 'ascii')
    .digest('base64url');
}

/**
 * Verify a code verifier against a stored S256 challenge.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyCodeVerifier(codeVerifier: string, codeChallenge: string): boolean {
  const computed = generateS256Challenge(codeVerifier);
  if (computed.length !== codeChallenge.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(codeChallenge));
}

/**
 * Validate that a code_verifier meets RFC 7636 requirements:
 * - 43-128 characters
 * - Only unreserved characters: [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
 */
export function validateCodeVerifier(codeVerifier: string): boolean {
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return false;
  return /^[A-Za-z0-9\-._~]+$/.test(codeVerifier);
}

/**
 * Validate that a code_challenge is a valid base64url-encoded SHA256 hash.
 * Must be exactly 43 characters of base64url alphabet.
 */
export function validateCodeChallenge(challenge: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(challenge);
}
