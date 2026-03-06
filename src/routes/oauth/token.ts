import { randomUUID } from 'node:crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createAccessToken, createRefreshToken, createIdToken, verifyToken } from '../../crypto/jwt';
import { verifyCodeVerifier, validateCodeVerifier } from '../../crypto/pkce';
import { markAuthCodeConsumed } from '../../crypto/authCodeTracker';
import { verifyScopes, resolveSignerContext } from '../../scopes';
import { authenticateClient } from '../../middleware/clientAuth';
import { checkClientRateLimit } from '../../middleware/clientRateLimit';
import { storeRefreshToken, rotateRefreshToken, getRefreshToken, RotateError } from '../../db/refreshTokens';
import {
  getDeviceCode as dbGetDeviceCode,
  deleteDeviceCode,
  updateLastPolledAt,
} from '../../db/deviceCodes';
import {
  AuthError,
  OAuthErrorCode,
  InvalidClientError,
  PkceRequiredError,
  DeviceCodeError,
  AuthorizationPendingError,
  SlowDownError,
} from '../../util/errors';
import { config } from '../../config';
import { TokenResponse } from '../../types';
import { getEpochInfo } from './shared';
import { TokenBodySchema } from '../../schemas/oauth';
import { TokenResponseSchema } from '../../schemas/responses';

type TokenBody = z.infer<typeof TokenBodySchema>;
type TokenClient = { client_id: string; rate_limit: number; grant_types: string[] };

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : '';
}

function buildTokenResponse(
  address: string,
  accessToken: string,
  refreshToken: string,
  scopes: string[],
  expiresIn: number,
  opts: {
    client_id: string;
    hotkey: string | null;
    coldkey: string | null;
    auth_time: number;
    nonce?: string | undefined;
  },
): TokenResponse {
  const response: TokenResponse = {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: scopes.join(' '),
  };

  if (scopes.includes('openid')) {
    response.id_token = createIdToken(address, scopes, accessToken, {
      client_id: opts.client_id,
      auth_time: opts.auth_time,
      nonce: opts.nonce,
      expiresIn,
      hotkey: opts.hotkey,
      coldkey: opts.coldkey,
    });
  }

  return response;
}

async function handleAuthorizationCode(
  request: FastifyRequest<{ Body: TokenBody }>,
  reply: FastifyReply,
  client: TokenClient,
  pkceRequired: boolean,
): Promise<FastifyReply> {
  const { code, redirect_uri, code_verifier } = request.body;

  if (!code) {
    throw new AuthError('Missing required parameter: code', 400, OAuthErrorCode.INVALID_REQUEST);
  }

  let claims;
  try {
    claims = verifyToken(code);
  } catch {
    throw new AuthError('Invalid or expired authorization code', 401, OAuthErrorCode.INVALID_GRANT);
  }

  if (claims.type !== 'auth_code') {
    throw new AuthError('Invalid token type', 401, OAuthErrorCode.INVALID_GRANT);
  }

  if (!claims.client_id) {
    throw new AuthError('Auth code missing client_id binding', 401, OAuthErrorCode.INVALID_GRANT);
  }
  if (claims.client_id !== client.client_id) {
    throw new InvalidClientError('client_id mismatch between authorize and token requests');
  }

  if (claims.redirect_uri && claims.redirect_uri !== redirect_uri) {
    throw new AuthError('redirect_uri mismatch', 400, OAuthErrorCode.INVALID_REQUEST);
  }

  if (pkceRequired || claims.code_challenge) {
    if (!code_verifier) {
      throw new PkceRequiredError();
    }
    if (!validateCodeVerifier(code_verifier)) {
      throw new AuthError('Invalid code_verifier format', 400, OAuthErrorCode.INVALID_REQUEST);
    }
    if (!claims.code_challenge) {
      throw new AuthError('Auth code was issued without code_challenge', 400, OAuthErrorCode.INVALID_REQUEST);
    }
    if (!verifyCodeVerifier(code_verifier, claims.code_challenge)) {
      throw new AuthError('PKCE verification failed', 401, OAuthErrorCode.INVALID_GRANT);
    }
  }

  if (!claims.jti) {
    throw new AuthError('Authorization code missing jti', 401, OAuthErrorCode.INVALID_GRANT);
  }

  const address = claims.sub;
  const scopes = claims.scope ? claims.scope.split(' ').filter(Boolean) : [];

  const { accessExpiry, epoch } = await getEpochInfo(scopes);

  const firstConsumption = await markAuthCodeConsumed(claims.jti);
  if (!firstConsumption) {
    throw new AuthError('Authorization code has already been used', 401, OAuthErrorCode.INVALID_GRANT);
  }

  const refreshJti = randomUUID();
  const hotkey = claims.hotkey ?? null;
  const coldkey = claims.coldkey ?? null;
  const authTime = claims.auth_time ?? Math.floor(Date.now() / 1000);

  const accessToken = createAccessToken(address, scopes, {
    client_id: client.client_id,
    expiresIn: accessExpiry,
    hotkey,
    coldkey,
  });
  const refreshToken = createRefreshToken(address, scopes, {
    jti: refreshJti,
    client_id: client.client_id,
    epoch: epoch ?? undefined,
    auth_time: authTime,
    hotkey,
    coldkey,
  });

  await storeRefreshToken({
    jti: refreshJti,
    client_id: client.client_id,
    address,
    scopes,
    epoch_at_issuance: epoch,
    expires_at: new Date(Date.now() + config.jwtRefreshTokenExpiry * 1000),
  });

  return reply.code(200).send(
    buildTokenResponse(address, accessToken, refreshToken, scopes, accessExpiry, {
      client_id: client.client_id, hotkey, coldkey, auth_time: authTime, nonce: claims.nonce,
    }),
  );
}

async function handleRefreshToken(
  request: FastifyRequest<{ Body: TokenBody }>,
  reply: FastifyReply,
  client: TokenClient,
): Promise<FastifyReply> {
  const { refresh_token } = request.body;

  if (!refresh_token) {
    throw new AuthError('Missing required parameter: refresh_token', 400, OAuthErrorCode.INVALID_REQUEST);
  }

  let claims;
  try {
    claims = verifyToken(refresh_token);
  } catch {
    throw new AuthError('Invalid or expired refresh token', 401, OAuthErrorCode.INVALID_GRANT);
  }

  if (claims.type !== 'refresh') {
    throw new AuthError('Invalid token type. Expected refresh token.', 401, OAuthErrorCode.INVALID_GRANT);
  }

  if (claims.client_id && claims.client_id !== client.client_id) {
    throw new InvalidClientError('Refresh token was issued to a different client');
  }

  if (!claims.jti) {
    throw new AuthError('Refresh token missing jti', 401, OAuthErrorCode.INVALID_GRANT);
  }

  const existingToken = await getRefreshToken(claims.jti);
  if (!existingToken) {
    throw new AuthError('Refresh token not found', 401, OAuthErrorCode.INVALID_GRANT);
  }
  if (existingToken.client_id !== client.client_id) {
    throw new InvalidClientError('Refresh token was issued to a different client');
  }
  if (existingToken.revoked) {
    throw new AuthError('Refresh token has been revoked', 401, OAuthErrorCode.INVALID_GRANT);
  }

  const address = claims.sub;
  const scopes = claims.scope ? claims.scope.split(' ').filter(Boolean) : [];

  // Start epoch query concurrently with scope verification
  const epochPromise = getEpochInfo(scopes);

  const signerCtx = await resolveSignerContext(address);

  if (scopes.length > 0) {
    await verifyScopes(signerCtx, scopes);
  }

  const { accessExpiry, epoch: currentEpoch } = await epochPromise;

  const newRefreshJti = randomUUID();
  try {
    await rotateRefreshToken(claims.jti, {
      jti: newRefreshJti,
      client_id: client.client_id,
      address,
      scopes,
      epoch_at_issuance: currentEpoch,
      expires_at: new Date(Date.now() + config.jwtRefreshTokenExpiry * 1000),
    });
  } catch (e: unknown) {
    const message = getErrorMessage(e);
    if (message === RotateError.NOT_FOUND) throw new AuthError('Refresh token not found', 401, OAuthErrorCode.INVALID_GRANT);
    if (message === RotateError.REVOKED) throw new AuthError('Refresh token has been revoked', 401, OAuthErrorCode.INVALID_GRANT);
    if (message === RotateError.EXPIRED) throw new AuthError('Refresh token expired', 401, OAuthErrorCode.INVALID_GRANT);
    throw e;
  }

  const authTime = claims.auth_time ?? Math.floor(Date.now() / 1000);

  const accessToken = createAccessToken(address, scopes, {
    client_id: client.client_id,
    expiresIn: accessExpiry,
    hotkey: signerCtx.hotkey,
    coldkey: signerCtx.coldkey,
  });
  const newRefreshToken = createRefreshToken(address, scopes, {
    jti: newRefreshJti,
    client_id: client.client_id,
    epoch: currentEpoch ?? undefined,
    auth_time: authTime,
    hotkey: signerCtx.hotkey,
    coldkey: signerCtx.coldkey,
  });

  return reply.code(200).send(
    buildTokenResponse(address, accessToken, newRefreshToken, scopes, accessExpiry, {
      client_id: client.client_id, hotkey: signerCtx.hotkey, coldkey: signerCtx.coldkey, auth_time: authTime,
    }),
  );
}

async function handleDeviceCode(
  request: FastifyRequest<{ Body: TokenBody }>,
  reply: FastifyReply,
  client: TokenClient,
): Promise<FastifyReply> {
  const { device_code } = request.body;

  if (!device_code) {
    throw new AuthError('Missing required parameter: device_code', 400, OAuthErrorCode.INVALID_REQUEST);
  }

  const entry = await dbGetDeviceCode(device_code);

  if (!entry) {
    throw new DeviceCodeError('Invalid device code', 404);
  }

  if (entry.clientId !== client.client_id) {
    throw new InvalidClientError('client_id mismatch');
  }

  if (new Date() > entry.expiresAt) {
    await deleteDeviceCode(device_code);
    throw new AuthError('Device code expired', 400, OAuthErrorCode.EXPIRED_TOKEN);
  }

  if (entry.denied) {
    await deleteDeviceCode(device_code);
    throw new AuthError('Authorization denied', 400, OAuthErrorCode.ACCESS_DENIED);
  }

  if (!entry.approved || !entry.address) {
    if (entry.lastPolledAt) {
      const elapsed = Date.now() - entry.lastPolledAt.getTime();
      if (elapsed < config.deviceCodePollInterval * 1000) {
        throw new SlowDownError();
      }
    }
    await updateLastPolledAt(device_code);
    throw new AuthorizationPendingError();
  }

  await deleteDeviceCode(device_code);

  const [{ accessExpiry, epoch }, signerCtx] = await Promise.all([
    getEpochInfo(entry.scopes),
    resolveSignerContext(entry.address),
  ]);

  if (entry.scopes.length > 0) {
    await verifyScopes(signerCtx, entry.scopes);
  }

  const refreshJti = randomUUID();
  const authTime = entry.approvedAt
    ? Math.floor(entry.approvedAt.getTime() / 1000)
    : Math.floor(Date.now() / 1000);
  const accessToken = createAccessToken(entry.address, entry.scopes, {
    client_id: client.client_id,
    expiresIn: accessExpiry,
    hotkey: signerCtx.hotkey,
    coldkey: signerCtx.coldkey,
  });
  const refreshToken = createRefreshToken(entry.address, entry.scopes, {
    jti: refreshJti,
    client_id: client.client_id,
    epoch: epoch ?? undefined,
    auth_time: authTime,
    hotkey: signerCtx.hotkey,
    coldkey: signerCtx.coldkey,
  });

  await storeRefreshToken({
    jti: refreshJti,
    client_id: client.client_id,
    address: entry.address,
    scopes: entry.scopes,
    epoch_at_issuance: epoch,
    expires_at: new Date(Date.now() + config.jwtRefreshTokenExpiry * 1000),
  });

  return reply.code(200).send(
    buildTokenResponse(entry.address, accessToken, refreshToken, entry.scopes, accessExpiry, {
      client_id: client.client_id, hotkey: signerCtx.hotkey, coldkey: signerCtx.coldkey, auth_time: authTime,
    }),
  );
}

export async function tokenRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /v1/oauth/token — unified token endpoint (RFC 6749)
  fastify.post('/v1/oauth/token', {
    schema: {
      tags: ['OAuth'],
      summary: 'Exchange credentials for tokens',
      body: TokenBodySchema,
      response: { 200: TokenResponseSchema },
    },
  }, async (request: FastifyRequest<{
    Body: TokenBody;
  }>, reply: FastifyReply) => {
    const { grant_type } = request.body;
    const { client, pkceRequired } = await authenticateClient(request);
    checkClientRateLimit(client.client_id, client.rate_limit);

    const allowedGrant = grant_type === 'urn:ietf:params:oauth:grant-type:device_code'
      ? client.grant_types.includes('urn:ietf:params:oauth:grant-type:device_code') || client.grant_types.includes('device_code')
      : client.grant_types.includes(grant_type);
    if (!allowedGrant) {
      throw new AuthError('This client is not authorized for the requested grant_type', 400, OAuthErrorCode.UNSUPPORTED_GRANT_TYPE);
    }

    switch (grant_type) {
      case 'authorization_code':
        return handleAuthorizationCode(request, reply, client, pkceRequired);
      case 'refresh_token':
        return handleRefreshToken(request, reply, client);
      case 'urn:ietf:params:oauth:grant-type:device_code':
        return handleDeviceCode(request, reply, client);
      default:
        throw new AuthError('Unsupported grant_type', 400, OAuthErrorCode.UNSUPPORTED_GRANT_TYPE);
    }
  });

  // POST /v1/oauth/refresh — backward-compat alias for refresh_token grant
  fastify.post('/v1/oauth/refresh', {
    schema: {
      tags: ['OAuth'],
      summary: 'Refresh token rotation',
      body: TokenBodySchema,
      response: { 200: TokenResponseSchema },
    },
  }, async (request: FastifyRequest<{
    Body: TokenBody;
  }>, reply: FastifyReply) => {
    const { grant_type } = request.body;

    if (grant_type !== 'refresh_token') {
      throw new AuthError('Unsupported grant_type. Use "refresh_token".', 400, OAuthErrorCode.UNSUPPORTED_GRANT_TYPE);
    }

    const { client } = await authenticateClient(request);
    checkClientRateLimit(client.client_id, client.rate_limit);

    return handleRefreshToken(request, reply, client);
  });
}
