import { randomUUID } from 'node:crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createAccessToken, createRefreshToken, createIdToken, verifyToken } from '../../crypto/jwt';
import { verifyCodeVerifier, validateCodeVerifier } from '../../crypto/pkce';
import { markAuthCodeConsumed } from '../../crypto/authCodeTracker';
import { verifyScopes, resolveSignerContext, resolveEvmSignerContext } from '../../scopes';
import { authenticateClient } from '../../middleware/clientAuth';
import { getClientSignMethod } from '../../crypto/address';
import { checkClientRateLimit } from '../../middleware/clientRateLimit';
import { getPool } from '../../db/pool';
import { storeRefreshToken, rotateRefreshToken, getRefreshToken, RotateError } from '../../db/refreshTokens';
import {
  beginDeviceCodeRedemption,
  commitDeviceCodeRedemption,
  rollbackDeviceCodeRedemption,
  deleteLockedDeviceCode,
  updateLockedDeviceCodeLastPolledAt,
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
import { enforceAllowedOriginForClient } from '../../middleware/origin';
import { recordTokenExchange, recordRefreshRotation, recordDeviceCodeStage } from '../../metrics/registry';
import { recordEvent } from '../../db/events';
import { SignMethod } from '../../crypto/address';

type TokenBody = z.infer<typeof TokenBodySchema>;
type TokenClient = { client_id: string; rate_limit: number; grant_types: string[]; allowed_sign_methods: string[] };
type TokenGrantType = 'authorization_code' | 'refresh_token' | 'urn:ietf:params:oauth:grant-type:device_code';

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : '';
}

function errorReasonFrom(err: unknown): string {
  if (err instanceof AuthError) return err.error || 'error';
  return 'internal_error';
}

function grantTypeToEventType(grant: string): 'token_exchange' | 'token_refresh' {
  return grant === 'refresh_token' ? 'token_refresh' : 'token_exchange';
}

function clientSignMethodLabel(client: TokenClient): SignMethod {
  return (client.allowed_sign_methods[0] as SignMethod) || 'sr25519';
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
    evm_address?: string | null | undefined;
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
      evm_address: opts.evm_address,
    });
  }

  return response;
}

interface HandlerResult {
  reply: FastifyReply;
  subject: string;
  scopes: string[];
}

async function handleAuthorizationCode(
  request: FastifyRequest<{ Body: TokenBody }>,
  reply: FastifyReply,
  client: TokenClient,
  pkceRequired: boolean,
): Promise<HandlerResult> {
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
    const codeChallengeMethod = claims.code_challenge_method ?? 'S256';
    if (codeChallengeMethod !== 'S256') {
      throw new AuthError(
        'Auth code was issued without supported code_challenge_method',
        400,
        OAuthErrorCode.INVALID_REQUEST,
      );
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

  const refreshJti = randomUUID();
  const hotkey = claims.hotkey ?? null;
  const coldkey = claims.coldkey ?? null;
  const evmAddress = claims.evm_address ?? null;
  const authTime = claims.auth_time ?? Math.floor(Date.now() / 1000);

  // Atomically consume auth code and store refresh token in one transaction.
  // If storeRefreshToken fails, the consumed marker rolls back too.
  const pool = getPool();
  const txClient = await pool.connect();
  try {
    await txClient.query('BEGIN');
    const firstConsumption = await markAuthCodeConsumed(claims.jti, txClient);
    if (!firstConsumption) {
      await txClient.query('ROLLBACK');
      throw new AuthError('Authorization code has already been used', 401, OAuthErrorCode.INVALID_GRANT);
    }
    await storeRefreshToken(
      {
        jti: refreshJti,
        client_id: client.client_id,
        address,
        scopes,
        epoch_at_issuance: epoch,
        expires_at: new Date(Date.now() + config.jwtRefreshTokenExpiry * 1000),
      },
      txClient,
    );
    await txClient.query('COMMIT');
  } catch (err) {
    await txClient.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    txClient.release();
  }

  const accessToken = createAccessToken(address, scopes, {
    client_id: client.client_id,
    expiresIn: accessExpiry,
    hotkey,
    coldkey,
    evm_address: evmAddress,
  });
  const refreshToken = createRefreshToken(address, scopes, {
    jti: refreshJti,
    client_id: client.client_id,
    epoch: epoch ?? undefined,
    auth_time: authTime,
    hotkey,
    coldkey,
    evm_address: evmAddress,
  });

  const sent = reply.code(200).send(
    buildTokenResponse(address, accessToken, refreshToken, scopes, accessExpiry, {
      client_id: client.client_id,
      hotkey,
      coldkey,
      auth_time: authTime,
      nonce: claims.nonce,
      evm_address: evmAddress,
    }),
  );
  return { reply: sent, subject: address, scopes };
}

async function handleRefreshToken(
  request: FastifyRequest<{ Body: TokenBody }>,
  reply: FastifyReply,
  client: TokenClient,
): Promise<HandlerResult> {
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
  const evmAddress = claims.evm_address ?? null;
  const isEvm = !!evmAddress;

  let accessExpiry: number;
  let currentEpoch: number | null = null;
  let signerCtx;

  if (isEvm) {
    // EVM refresh: skip on-chain verification, use config expiry
    accessExpiry = config.jwtAccessTokenExpiry;
    signerCtx = resolveEvmSignerContext(address);
  } else {
    // Start epoch query concurrently with scope verification
    const epochPromise = getEpochInfo(scopes);

    signerCtx = await resolveSignerContext(address);

    if (scopes.length > 0) {
      await verifyScopes(signerCtx, scopes);
    }

    const epochInfo = await epochPromise;
    accessExpiry = epochInfo.accessExpiry;
    currentEpoch = epochInfo.epoch;
  }

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
    if (message === RotateError.NOT_FOUND)
      throw new AuthError('Refresh token not found', 401, OAuthErrorCode.INVALID_GRANT);
    if (message === RotateError.REVOKED)
      throw new AuthError('Refresh token has been revoked', 401, OAuthErrorCode.INVALID_GRANT);
    if (message === RotateError.EXPIRED)
      throw new AuthError('Refresh token expired', 401, OAuthErrorCode.INVALID_GRANT);
    throw e;
  }

  const authTime = claims.auth_time ?? Math.floor(Date.now() / 1000);

  const accessToken = createAccessToken(address, scopes, {
    client_id: client.client_id,
    expiresIn: accessExpiry,
    hotkey: signerCtx.hotkey,
    coldkey: signerCtx.coldkey,
    evm_address: signerCtx.evmAddress,
  });
  const newRefreshToken = createRefreshToken(address, scopes, {
    jti: newRefreshJti,
    client_id: client.client_id,
    epoch: currentEpoch ?? undefined,
    auth_time: authTime,
    hotkey: signerCtx.hotkey,
    coldkey: signerCtx.coldkey,
    evm_address: signerCtx.evmAddress,
  });

  const sent = reply.code(200).send(
    buildTokenResponse(address, accessToken, newRefreshToken, scopes, accessExpiry, {
      client_id: client.client_id,
      hotkey: signerCtx.hotkey,
      coldkey: signerCtx.coldkey,
      auth_time: authTime,
      evm_address: signerCtx.evmAddress,
    }),
  );
  return { reply: sent, subject: address, scopes };
}

async function handleDeviceCode(
  request: FastifyRequest<{ Body: TokenBody }>,
  reply: FastifyReply,
  client: TokenClient,
): Promise<HandlerResult> {
  const { device_code } = request.body;

  if (!device_code) {
    throw new AuthError('Missing required parameter: device_code', 400, OAuthErrorCode.INVALID_REQUEST);
  }

  const redemption = await beginDeviceCodeRedemption(device_code);
  if (!redemption) {
    throw new DeviceCodeError('Invalid device code', 404);
  }
  const { client: redemptionClient, entry: claimed } = redemption;
  let redemptionSettled = false;

  try {
    if (claimed.clientId !== client.client_id) {
      throw new InvalidClientError('client_id mismatch');
    }

    if (new Date() > claimed.expiresAt) {
      await deleteLockedDeviceCode(redemptionClient, device_code);
      redemptionSettled = true;
      await commitDeviceCodeRedemption(redemptionClient);
      recordDeviceCodeStage({ client_id: client.client_id, stage: 'expired', outcome: 'failure' });
      recordEvent({
        client_id: client.client_id,
        event_type: 'device_code_expired',
        outcome: 'failure',
      }).catch(() => {});
      throw new AuthError('Device code expired', 400, OAuthErrorCode.EXPIRED_TOKEN);
    }

    if (claimed.denied) {
      await deleteLockedDeviceCode(redemptionClient, device_code);
      redemptionSettled = true;
      await commitDeviceCodeRedemption(redemptionClient);
      recordDeviceCodeStage({ client_id: client.client_id, stage: 'denied', outcome: 'failure' });
      recordEvent({
        client_id: client.client_id,
        event_type: 'device_code_denied',
        outcome: 'failure',
      }).catch(() => {});
      throw new AuthError('Authorization denied', 400, OAuthErrorCode.ACCESS_DENIED);
    }

    if (!claimed.approved || !claimed.address) {
      if (claimed.lastPolledAt) {
        const elapsed = Date.now() - claimed.lastPolledAt.getTime();
        if (elapsed < config.deviceCodePollInterval * 1000) {
          await rollbackDeviceCodeRedemption(redemptionClient);
          redemptionSettled = true;
          throw new SlowDownError();
        }
      }

      await updateLockedDeviceCodeLastPolledAt(redemptionClient, device_code);
      redemptionSettled = true;
      await commitDeviceCodeRedemption(redemptionClient);
      recordEvent({
        client_id: client.client_id,
        event_type: 'device_code_polled',
        outcome: 'pending',
      }).catch(() => {});
      throw new AuthorizationPendingError();
    }

    const isEvm = getClientSignMethod(client.allowed_sign_methods) === 'evm';

    let signerCtx;
    let accessExpiry: number;
    let epoch: number | null = null;

    if (isEvm) {
      signerCtx = resolveEvmSignerContext(claimed.address!);
      accessExpiry = config.jwtAccessTokenExpiry;
    } else {
      const [epochInfo, ctx] = await Promise.all([
        getEpochInfo(claimed.scopes),
        resolveSignerContext(claimed.address!),
      ]);
      signerCtx = ctx;
      accessExpiry = epochInfo.accessExpiry;
      epoch = epochInfo.epoch;

      if (claimed.scopes.length > 0) {
        await verifyScopes(signerCtx, claimed.scopes);
      }
    }

    const refreshJti = randomUUID();
    const authTime = claimed.approvedAt
      ? Math.floor(claimed.approvedAt.getTime() / 1000)
      : Math.floor(Date.now() / 1000);
    const accessToken = createAccessToken(claimed.address!, claimed.scopes, {
      client_id: client.client_id,
      expiresIn: accessExpiry,
      hotkey: signerCtx.hotkey,
      coldkey: signerCtx.coldkey,
      evm_address: signerCtx.evmAddress,
    });
    const refreshToken = createRefreshToken(claimed.address!, claimed.scopes, {
      jti: refreshJti,
      client_id: client.client_id,
      epoch: epoch ?? undefined,
      auth_time: authTime,
      hotkey: signerCtx.hotkey,
      coldkey: signerCtx.coldkey,
      evm_address: signerCtx.evmAddress,
    });

    await storeRefreshToken(
      {
        jti: refreshJti,
        client_id: client.client_id,
        address: claimed.address!,
        scopes: claimed.scopes,
        epoch_at_issuance: epoch,
        expires_at: new Date(Date.now() + config.jwtRefreshTokenExpiry * 1000),
      },
      redemptionClient,
    );

    await deleteLockedDeviceCode(redemptionClient, device_code);
    redemptionSettled = true;
    await commitDeviceCodeRedemption(redemptionClient);

    const sent = reply.code(200).send(
      buildTokenResponse(claimed.address!, accessToken, refreshToken, claimed.scopes, accessExpiry, {
        client_id: client.client_id,
        hotkey: signerCtx.hotkey,
        coldkey: signerCtx.coldkey,
        auth_time: authTime,
        evm_address: signerCtx.evmAddress,
      }),
    );
    return { reply: sent, subject: claimed.address!, scopes: claimed.scopes };
  } catch (err) {
    if (!redemptionSettled) {
      await rollbackDeviceCodeRedemption(redemptionClient);
    }
    throw err;
  }
}

export async function tokenRoutes(fastify: FastifyInstance): Promise<void> {
  // RFC 6749 §5.1: token responses MUST include these cache headers
  fastify.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Pragma', 'no-cache');
  });

  // POST /v1/oauth/token — unified token endpoint (RFC 6749)
  fastify.post(
    '/v1/oauth/token',
    {
      schema: {
        tags: ['OAuth'],
        summary: 'Exchange credentials for tokens',
        body: TokenBodySchema,
        response: { 200: TokenResponseSchema },
      },
    },
    async (
      request: FastifyRequest<{
        Body: TokenBody;
      }>,
      reply: FastifyReply,
    ) => {
      const { grant_type } = request.body;
      const { client, pkceRequired } = await authenticateClient(request);
      enforceAllowedOriginForClient(request, client.allowed_origins);
      // Device-code polling is RFC 8628; CLIs only handle OAuth error codes,
      // so map rate-limit exceed to `slow_down` instead of a bare HTTP 429.
      const isDeviceCodeGrant = grant_type === 'urn:ietf:params:oauth:grant-type:device_code';
      checkClientRateLimit(client.client_id, client.rate_limit, 'token', {
        slowDownOnExceed: isDeviceCodeGrant,
      });

      const allowedGrant =
        grant_type === 'urn:ietf:params:oauth:grant-type:device_code'
          ? client.grant_types.includes('urn:ietf:params:oauth:grant-type:device_code') ||
            client.grant_types.includes('device_code')
          : client.grant_types.includes(grant_type);
      if (!allowedGrant) {
        throw new AuthError(
          'This client is not authorized for the requested grant_type',
          400,
          OAuthErrorCode.UNSUPPORTED_GRANT_TYPE,
        );
      }

      const signMethod = clientSignMethodLabel(client);
      const grantLabel = grant_type as TokenGrantType;
      try {
        let outcome: HandlerResult;
        switch (grant_type) {
          case 'authorization_code':
            outcome = await handleAuthorizationCode(request, reply, client, pkceRequired);
            break;
          case 'refresh_token':
            outcome = await handleRefreshToken(request, reply, client);
            break;
          case 'urn:ietf:params:oauth:grant-type:device_code':
            outcome = await handleDeviceCode(request, reply, client);
            break;
          default:
            throw new AuthError('Unsupported grant_type', 400, OAuthErrorCode.UNSUPPORTED_GRANT_TYPE);
        }
        recordTokenExchange({
          client_id: client.client_id,
          grant_type: grantLabel,
          outcome: 'success',
          sign_method: signMethod,
        });
        if (grant_type === 'refresh_token') {
          recordRefreshRotation({ client_id: client.client_id, outcome: 'success' });
        }
        if (grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
          recordDeviceCodeStage({ client_id: client.client_id, stage: 'approved', outcome: 'success' });
        }
        recordEvent({
          client_id: client.client_id,
          event_type: grantTypeToEventType(grant_type),
          outcome: 'success',
          sign_method: signMethod,
          subject: outcome.subject,
          scopes: outcome.scopes,
        }).catch(() => {});
        return outcome.reply;
      } catch (err) {
        if (err instanceof AuthorizationPendingError) {
          // Normal device-code polling state, not a failure
          recordDeviceCodeStage({ client_id: client.client_id, stage: 'polled', outcome: 'pending' });
          throw err;
        }
        if (err instanceof SlowDownError) {
          // Client polling too fast — record as polled failure
          recordDeviceCodeStage({ client_id: client.client_id, stage: 'polled', outcome: 'failure' });
          throw err;
        }
        const reason = errorReasonFrom(err);
        recordTokenExchange({
          client_id: client.client_id,
          grant_type: grantLabel,
          outcome: 'failure',
          error_reason: reason,
          sign_method: signMethod,
        });
        if (grant_type === 'refresh_token') {
          recordRefreshRotation({ client_id: client.client_id, outcome: 'failure', error_reason: reason });
        }
        recordEvent({
          client_id: client.client_id,
          event_type: grantTypeToEventType(grant_type),
          outcome: 'failure',
          error_reason: reason,
          sign_method: signMethod,
        }).catch(() => {});
        throw err;
      }
    },
  );

  // POST /v1/oauth/refresh — backward-compat alias for refresh_token grant
  fastify.post(
    '/v1/oauth/refresh',
    {
      schema: {
        tags: ['OAuth'],
        summary: 'Refresh token rotation',
        body: TokenBodySchema,
        response: { 200: TokenResponseSchema },
      },
    },
    async (
      request: FastifyRequest<{
        Body: TokenBody;
      }>,
      reply: FastifyReply,
    ) => {
      const { grant_type } = request.body;

      if (grant_type !== 'refresh_token') {
        throw new AuthError('Unsupported grant_type. Use "refresh_token".', 400, OAuthErrorCode.UNSUPPORTED_GRANT_TYPE);
      }

      const { client } = await authenticateClient(request);
      enforceAllowedOriginForClient(request, client.allowed_origins);
      checkClientRateLimit(client.client_id, client.rate_limit, 'token');

      const signMethod = clientSignMethodLabel(client);
      try {
        const outcome = await handleRefreshToken(request, reply, client);
        recordTokenExchange({
          client_id: client.client_id,
          grant_type: 'refresh_token',
          outcome: 'success',
          sign_method: signMethod,
        });
        recordRefreshRotation({ client_id: client.client_id, outcome: 'success' });
        recordEvent({
          client_id: client.client_id,
          event_type: 'token_refresh',
          outcome: 'success',
          sign_method: signMethod,
          subject: outcome.subject,
          scopes: outcome.scopes,
        }).catch(() => {});
        return outcome.reply;
      } catch (err) {
        const reason = errorReasonFrom(err);
        recordTokenExchange({
          client_id: client.client_id,
          grant_type: 'refresh_token',
          outcome: 'failure',
          error_reason: reason,
          sign_method: signMethod,
        });
        recordRefreshRotation({ client_id: client.client_id, outcome: 'failure', error_reason: reason });
        recordEvent({
          client_id: client.client_id,
          event_type: 'token_refresh',
          outcome: 'failure',
          error_reason: reason,
          sign_method: signMethod,
        }).catch(() => {});
        throw err;
      }
    },
  );
}
