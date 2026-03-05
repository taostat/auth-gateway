import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { getKid, getPrivateKey, getPublicKey } from './keys';
import { config } from '../config';
import { JwtClaims } from '../types';

export function createAccessToken(
  address: string,
  scopes: string[],
  opts?: { client_id?: string | undefined; expiresIn?: number | undefined; hotkey?: string | null | undefined; coldkey?: string | null | undefined },
): string {
  return jwt.sign(
    {
      sub: address,
      scope: scopes.join(' '),
      type: 'access',
      jti: uuidv4(),
      ...(opts?.client_id && { client_id: opts.client_id }),
      hotkey: opts?.hotkey ?? null,
      coldkey: opts?.coldkey ?? null,
    },
    getPrivateKey(),
    {
      algorithm: 'RS256',
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
      expiresIn: opts?.expiresIn ?? config.jwtAccessTokenExpiry,
      keyid: getKid(),
    },
  );
}

export function createRefreshToken(
  address: string,
  scopes: string[],
  opts?: { jti?: string | undefined; client_id?: string | undefined; epoch?: number | undefined; auth_time?: number | undefined; hotkey?: string | null | undefined; coldkey?: string | null | undefined },
): string {
  return jwt.sign(
    {
      sub: address,
      scope: scopes.join(' '),
      type: 'refresh',
      jti: opts?.jti || uuidv4(),
      ...(opts?.client_id && { client_id: opts.client_id }),
      ...(opts?.epoch != null && { epoch: opts.epoch }),
      ...(opts?.auth_time != null && { auth_time: opts.auth_time }),
      hotkey: opts?.hotkey ?? null,
      coldkey: opts?.coldkey ?? null,
    },
    getPrivateKey(),
    {
      algorithm: 'RS256',
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
      expiresIn: config.jwtRefreshTokenExpiry,
      keyid: getKid(),
    },
  );
}

export function createAuthCode(
  address: string,
  scopes: string[],
  opts?: {
    client_id?: string | undefined;
    redirect_uri?: string | undefined;
    code_challenge?: string | undefined;
    nonce?: string | undefined;
    auth_time?: number | undefined;
    hotkey?: string | null | undefined;
    coldkey?: string | null | undefined;
  },
): string {
  return jwt.sign(
    {
      sub: address,
      scope: scopes.join(' '),
      type: 'auth_code',
      jti: uuidv4(),
      ...(opts?.client_id && { client_id: opts.client_id }),
      ...(opts?.redirect_uri && { redirect_uri: opts.redirect_uri }),
      ...(opts?.code_challenge && { code_challenge: opts.code_challenge }),
      ...(opts?.nonce && { nonce: opts.nonce }),
      ...(opts?.auth_time != null && { auth_time: opts.auth_time }),
      hotkey: opts?.hotkey ?? null,
      coldkey: opts?.coldkey ?? null,
    },
    getPrivateKey(),
    {
      algorithm: 'RS256',
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
      expiresIn: config.jwtAuthCodeExpiry,
      keyid: getKid(),
    },
  );
}

/**
 * Compute at_hash: left half of SHA-256 of the access token, base64url-encoded.
 * Per OpenID Connect Core 1.0, Section 3.1.3.6.
 */
export function computeAtHash(accessToken: string): string {
  const hash = createHash('sha256').update(accessToken).digest();
  return hash.subarray(0, hash.length / 2)
    .toString('base64url');
}

export function createIdToken(
  address: string,
  scopes: string[],
  accessToken: string,
  opts: {
    client_id: string;
    auth_time: number;
    nonce?: string | undefined;
    expiresIn?: number | undefined;
    hotkey?: string | null | undefined;
    coldkey?: string | null | undefined;
  },
): string {
  return jwt.sign(
    {
      sub: address,
      scope: scopes.join(' '),
      type: 'id',
      at_hash: computeAtHash(accessToken),
      auth_time: opts.auth_time,
      ...(opts.nonce && { nonce: opts.nonce }),
      client_id: opts.client_id,
      hotkey: opts.hotkey ?? null,
      coldkey: opts.coldkey ?? null,
    },
    getPrivateKey(),
    {
      algorithm: 'RS256',
      issuer: config.jwtIssuer,
      audience: opts.client_id,
      expiresIn: opts.expiresIn ?? config.jwtAccessTokenExpiry,
      keyid: getKid(),
    },
  );
}

/**
 * Verify an ID token. Unlike verifyToken, this accepts
 * the client_id as the expected audience (per OIDC spec).
 */
const CLOCK_TOLERANCE_SECONDS = 5;

export function verifyIdToken(
  token: string,
  clientId: string,
): JwtClaims {
  const decoded = jwt.verify(token, getPublicKey(), {
    algorithms: ['RS256'],
    issuer: config.jwtIssuer,
    audience: clientId,
    clockTolerance: CLOCK_TOLERANCE_SECONDS,
  });
  return decoded as JwtClaims;
}

export function verifyToken(token: string): JwtClaims {
  const decoded = jwt.verify(token, getPublicKey(), {
    algorithms: ['RS256'],
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    clockTolerance: CLOCK_TOLERANCE_SECONDS,
  });
  return decoded as JwtClaims;
}
