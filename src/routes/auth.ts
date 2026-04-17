import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChallenge, consumeChallenge } from '../crypto/challenge';
import { verifySignatureOrThrow } from '../crypto/signature';
import { createAccessToken } from '../crypto/jwt';
import { validateAndNormalizeAddress } from '../crypto/address';
import {
  verifyScopes,
  validateScopes,
  validateScopesForSignMethod,
  resolveSignerContext,
  resolveEvmSignerContext,
} from '../scopes';
import { AuthError, InvalidAddressError } from '../util/errors';
import { config } from '../config';
import { ChallengeBodySchema, VerifyBodySchema } from '../schemas/auth';
import { ChallengeResponseSchema, TokenResponseSchema } from '../schemas/responses';
import { ChallengeResponse, TokenResponse } from '../types';
import { getAccessTokenExpiry } from './oauth/shared';
import { recordChallenge } from '../metrics/registry';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /v1/auth/challenge
  fastify.post(
    '/v1/auth/challenge',
    {
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
    },
    async (
      request: FastifyRequest<{
        Body: z.infer<typeof ChallengeBodySchema>;
      }>,
      reply: FastifyReply,
    ) => {
      const { address: rawAddress, scopes = [] } = request.body;

      let address = rawAddress;
      let signMethod: 'sr25519' | 'evm' | undefined;
      if (address) {
        const result = validateAndNormalizeAddress(address);
        address = result.address;
        signMethod = result.method;
        validateScopesForSignMethod(scopes, result.method);
      }

      if (scopes.length > 0) {
        validateScopes(scopes);
      }

      const challenge = await createChallenge(address || null, scopes, { flowType: 'auth' });

      recordChallenge({ sign_method: signMethod ?? 'unknown', outcome: 'issued' });

      const response: ChallengeResponse = {
        nonce: challenge.nonce,
        expires_in: config.challengeTtlSeconds,
      };

      return reply.code(200).send(response);
    },
  );

  // POST /v1/auth/verify
  fastify.post(
    '/v1/auth/verify',
    {
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
    },
    async (
      request: FastifyRequest<{
        Body: z.infer<typeof VerifyBodySchema>;
      }>,
      reply: FastifyReply,
    ) => {
      const { nonce, address: rawAddress, signature } = request.body;

      let address: string;
      let method: 'sr25519' | 'evm';
      try {
        const normalized = validateAndNormalizeAddress(rawAddress);
        address = normalized.address;
        method = normalized.method;
      } catch (err) {
        recordChallenge({ sign_method: 'unknown', outcome: 'failure' });
        throw err;
      }

      // Consume challenge (single-use, throws if expired/missing)
      const challenge = await consumeChallenge(nonce);

      if (challenge.flowType && challenge.flowType !== 'auth') {
        throw new AuthError('Challenge was created for a different authentication flow', 400, 'Bad Request');
      }

      // Verify address matches the challenge (skip if challenge was created without address)
      if (challenge.address && challenge.address !== address) {
        throw new InvalidAddressError();
      }

      // Verify signature (method-aware)
      try {
        await verifySignatureOrThrow(nonce, signature, address, method);
      } catch (sigErr) {
        recordChallenge({ sign_method: method, outcome: 'failure' });
        throw sigErr;
      }

      // Enforce scope-method compatibility (always, not just at challenge time)
      const isEvm = method === 'evm';
      validateScopesForSignMethod(challenge.scopes, method);

      const signerCtx = isEvm ? resolveEvmSignerContext(address) : await resolveSignerContext(address);

      if (!isEvm && challenge.scopes.length > 0) {
        await verifyScopes(signerCtx, challenge.scopes);
      }

      const accessExpiry = isEvm ? config.jwtAccessTokenExpiry : await getAccessTokenExpiry(challenge.scopes);

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

      recordChallenge({ sign_method: method, outcome: 'verified' });

      return reply.code(200).send(response);
    },
  );
}
