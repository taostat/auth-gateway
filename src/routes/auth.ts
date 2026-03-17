import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChallenge, consumeChallenge } from '../crypto/challenge';
import { verifySignatureOrThrow } from '../crypto/signature';
import { createAccessToken } from '../crypto/jwt';
import { validateAndNormalizeAddress } from '../crypto/address';
import { verifyScopes, validateScopes, validateScopesForSignMethod, resolveSignerContext, resolveEvmSignerContext } from '../scopes';
import { InvalidAddressError } from '../util/errors';
import { config } from '../config';
import { ChallengeBodySchema, VerifyBodySchema } from '../schemas/auth';
import { ChallengeResponseSchema, TokenResponseSchema } from '../schemas/responses';
import { ChallengeResponse, TokenResponse } from '../types';
import { getAccessTokenExpiry } from './oauth/shared';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /v1/auth/challenge
  fastify.post('/v1/auth/challenge', {
    schema: {
      tags: ['Auth'],
      summary: 'Request a signing challenge',
      body: ChallengeBodySchema,
      response: { 200: ChallengeResponseSchema },
    },
    config: {
      rateLimit: {
        max: config.rateLimitChallenge,
        timeWindow: '1 minute',
      },
    },
  }, async (request: FastifyRequest<{
    Body: z.infer<typeof ChallengeBodySchema>;
  }>, reply: FastifyReply) => {
    const { address: rawAddress, scopes = [] } = request.body;

    let address = rawAddress;
    if (address) {
      const result = validateAndNormalizeAddress(address);
      address = result.address;
      validateScopesForSignMethod(scopes, result.method);
    }

    if (scopes.length > 0) {
      validateScopes(scopes);
    }

    const challenge = await createChallenge(address || null, scopes);

    const response: ChallengeResponse = {
      nonce: challenge.nonce,
      expires_in: config.challengeTtlSeconds,
    };

    return reply.code(200).send(response);
  });

  // POST /v1/auth/verify
  fastify.post('/v1/auth/verify', {
    schema: {
      tags: ['Auth'],
      summary: 'Submit signature, receive access token',
      body: VerifyBodySchema,
      response: { 200: TokenResponseSchema },
    },
    config: {
      rateLimit: {
        max: config.rateLimitChallenge,
        timeWindow: '1 minute',
      },
    },
  }, async (request: FastifyRequest<{
    Body: z.infer<typeof VerifyBodySchema>;
  }>, reply: FastifyReply) => {
    const { nonce, address: rawAddress, signature } = request.body;

    const { address, method } = validateAndNormalizeAddress(rawAddress);

    // Consume challenge (single-use, throws if expired/missing)
    const challenge = await consumeChallenge(nonce);

    // Verify address matches the challenge (skip if challenge was created without address)
    if (challenge.address && challenge.address !== address) {
      throw new InvalidAddressError();
    }

    // Verify signature (method-aware)
    await verifySignatureOrThrow(nonce, signature, address, method);

    // Enforce scope-method compatibility (always, not just at challenge time)
    const isEvm = method === 'evm';
    validateScopesForSignMethod(challenge.scopes, method);

    const signerCtx = isEvm
      ? resolveEvmSignerContext(address)
      : await resolveSignerContext(address);

    if (!isEvm && challenge.scopes.length > 0) {
      await verifyScopes(signerCtx, challenge.scopes);
    }

    const accessExpiry = isEvm
      ? config.jwtAccessTokenExpiry
      : await getAccessTokenExpiry(challenge.scopes);

    // Issue access token only for direct flow.
    // Refresh token rotation/revocation is enforced in OAuth/device flows with client context.
    const accessToken = createAccessToken(address, challenge.scopes, {
      expiresIn: accessExpiry,
      hotkey: signerCtx.hotkey,
      coldkey: signerCtx.coldkey,
      evm_address: signerCtx.evmAddress,
    });

    const response: TokenResponse = {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: accessExpiry,
      scope: challenge.scopes.join(' '),
    };

    return reply.code(200).send(response);
  });
}
