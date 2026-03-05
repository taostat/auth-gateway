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
      scopes,
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
  opts?: { jti?: string | undefined; client_id?: string | undefined; epoch?: number | undefined; hotkey?: string | null | undefined; coldkey?: string | null | undefined },
): string {
  return jwt.sign(
    {
      sub: address,
      scopes,
      type: 'refresh',
      jti: opts?.jti || uuidv4(),
      ...(opts?.client_id && { client_id: opts.client_id }),
      ...(opts?.epoch != null && { epoch: opts.epoch }),
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
    hotkey?: string | null | undefined;
    coldkey?: string | null | undefined;
  },
): string {
  return jwt.sign(
    {
      sub: address,
      scopes,
      type: 'auth_code',
      jti: uuidv4(),
      ...(opts?.client_id && { client_id: opts.client_id }),
      ...(opts?.redirect_uri && { redirect_uri: opts.redirect_uri }),
      ...(opts?.code_challenge && { code_challenge: opts.code_challenge }),
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

export function verifyToken(token: string): JwtClaims {
  const decoded = jwt.verify(token, getPublicKey(), {
    algorithms: ['RS256'],
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
  });
  return decoded as JwtClaims;
}
