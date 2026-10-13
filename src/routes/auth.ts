import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChallenge, consumeChallenge } from '../crypto/challenge';
import { verifySignatureOrThrow } from '../crypto/signature';
import { createAccessToken } from '../crypto/jwt';
import { getClientSignMethod, SignMethod, validateAndNormalizeAddress } from '../crypto/address';
import { getClientById } from '../db/clients';
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
import { ChallengeBindings, ChallengeResponse, TokenResponse } from '../types';
import { getAccessTokenExpiry } from './oauth/shared';
import { recordChallenge } from '../metrics/registry';

async function validateBoundClient(clientId: string, signMethod: SignMethod | undefined): Promise<void> {
  const client = await getClientById(clientId, { fresh: true });
  if (!client) throw new AuthError('Unknown or inactive OAuth client', 400, 'Bad Request');
  const clientSignMethod = getClientSignMethod(client.allowed_sign_methods);
  if (signMethod !== clientSignMethod) {
    throw new AuthError('This client requires a different wallet type', 400, 'Bad Request');
  }
}

async function getChallengeBindings(
  body: z.infer<typeof ChallengeBodySchema>,
  address: string | undefined,
  signMethod: SignMethod | undefined,
): Promise<ChallengeBindings | undefined> {
  const { client_id: clientId, purpose, context, scopes } = body;
  if (clientId === undefined) {
    if (purpose !== undefined || context !== undefined) {
      throw new AuthError('purpose and context require client_id', 400, 'Bad Request');
    }
    return undefined;
  }
  if (purpose === undefined) throw new AuthError('purpose is required for a bound challenge', 400, 'Bad Request');
  if (!address) throw new AuthError('address is required for a bound challenge', 400, 'Bad Request');
  if (scopes.length > 0) throw new AuthError('scopes cannot be used with a bound challenge', 400, 'Bad Request');

  await validateBoundClient(clientId, signMethod);

  return { flowType: 'auth', clientId, purpose, context };
}

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
      let signMethod: SignMethod | undefined;
      if (address) {
        const result = validateAndNormalizeAddress(address);
        address = result.address;
        signMethod = result.method;
        validateScopesForSignMethod(scopes, result.method);
      }

      if (scopes.length > 0) {
        validateScopes(scopes);
      }

      const bindings = await getChallengeBindings(request.body, address, signMethod);
      const challenge = await createChallenge(address || null, scopes, {
        flowType: 'auth',
        ...bindings,
      });

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
      let method: SignMethod;
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

      if (challenge.clientId !== null || challenge.purpose !== null || challenge.context !== null) {
        // Client deletion sets client_id to NULL; retain the complete binding or reject it.
        if (!challenge.clientId || !challenge.purpose || !challenge.address) {
          throw new AuthError('Incomplete bound challenge', 400, 'Bad Request');
        }
        await validateBoundClient(challenge.clientId, method);
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
        client_id: challenge.clientId ?? undefined,
        purpose: challenge.purpose ?? undefined,
        context: challenge.context ?? undefined,
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
