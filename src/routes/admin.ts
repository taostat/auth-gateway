import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from '../config';
import { createClient, listClients, deactivateClient, updateClient, rotateClientSecret, getClientById, UpdateClientFields } from '../db/clients';
import { AdminAuthError, AuthError } from '../util/errors';
import { validateScopeFormat } from '../scopes';
import { CreateClientBodySchema, UpdateClientBodySchema, ClientIdParamsSchema } from '../schemas/admin';
import { ErrorResponseSchema } from '../schemas/responses';
import { normalizeAllowedOrigins } from '../middleware/origin';

function requireAdmin(request: FastifyRequest): void {
  const key = request.headers['x-admin-api-key'] as string | undefined;
  if (!config.adminApiKey || !key) {
    throw new AdminAuthError();
  }
  const expected = Buffer.from(config.adminApiKey);
  const provided = Buffer.from(key);
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    throw new AdminAuthError();
  }
}

function validateRedirectUri(uri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new AuthError(`Invalid redirect_uri: ${uri}`, 400, 'Bad Request');
  }

  // Reject fragments
  if (parsed.hash) {
    throw new AuthError('redirect_uri must not contain a fragment', 400, 'Bad Request');
  }

  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
    throw new AuthError('redirect_uri must be an http(s) URL without embedded credentials', 400, 'Bad Request');
  }

  // Require HTTPS in production (except localhost)
  if (config.nodeEnv === 'production') {
    const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !isLocalhost) {
      throw new AuthError('redirect_uri must use HTTPS in production', 400, 'Bad Request');
    }
  }
}

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /v1/admin/clients — register a new OAuth client
  fastify.post(
    '/v1/admin/clients',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Register a new OAuth client',
        security: [{ adminApiKey: [] }],
        body: CreateClientBodySchema,
        response: { 400: ErrorResponseSchema },
      },
    },
    async (
      request: FastifyRequest<{
        Body: z.infer<typeof CreateClientBodySchema>;
      }>,
      reply: FastifyReply,
    ) => {
      requireAdmin(request);

      const {
        client_name,
        client_type,
        redirect_uris,
        grant_types,
        allowed_scopes,
        allowed_origins,
        allowed_sign_methods,
        rate_limit,
      } = request.body;

      const CALLBACK_GRANTS = new Set(['authorization_code']);
      const effectiveGrantTypes = grant_types ?? ['authorization_code'];
      const needsCallback = effectiveGrantTypes.some((g) => CALLBACK_GRANTS.has(g));
      const normalizedAllowedOrigins = normalizeAllowedOrigins(allowed_origins);

      if (needsCallback && (!Array.isArray(redirect_uris) || redirect_uris.length === 0)) {
        throw new AuthError('redirect_uris required unless grant type is device_code only', 400, 'Bad Request');
      }

      // Validate each redirect_uri
      for (const uri of redirect_uris) {
        validateRedirectUri(uri);
      }

      // Validate allowed_sign_methods: must have exactly one element
      if (allowed_sign_methods.length !== 1) {
        throw new AuthError('allowed_sign_methods must contain exactly one sign method', 400, 'Bad Request');
      }

      // Validate each scope format
      if (allowed_scopes) {
        for (const scope of allowed_scopes) {
          if (!validateScopeFormat(scope)) {
            throw new AuthError(`Invalid scope format: ${scope}`, 400, 'Bad Request');
          }
        }
      }

      // EVM clients must explicitly set allowed_scopes to ['openid']
      if (allowed_sign_methods.includes('evm')) {
        if (!allowed_scopes || allowed_scopes.length === 0) {
          throw new AuthError('EVM clients must specify allowed_scopes: ["openid"]', 400, 'Bad Request');
        }
        const nonOpenid = allowed_scopes.filter((s) => s !== 'openid');
        if (nonOpenid.length > 0) {
          throw new AuthError('EVM clients can only use the "openid" scope', 400, 'Bad Request');
        }
      }

      const result = await createClient({
        client_name,
        client_type,
        redirect_uris,
        grant_types: effectiveGrantTypes,
        allowed_scopes,
        allowed_origins: normalizedAllowedOrigins,
        allowed_sign_methods,
        rate_limit,
      });

      return reply.code(201).send({
        client_id: result.client.client_id,
        client_secret: result.client_secret,
        client_name: result.client.client_name,
        client_type: result.client.client_type,
        redirect_uris: result.client.redirect_uris,
        grant_types: result.client.grant_types,
        allowed_scopes: result.client.allowed_scopes,
        allowed_origins: result.client.allowed_origins,
        allowed_sign_methods: result.client.allowed_sign_methods,
        rate_limit: result.client.rate_limit,
      });
    },
  );

  // GET /v1/admin/clients — list all registered clients
  fastify.get(
    '/v1/admin/clients',
    {
      schema: {
        tags: ['Admin'],
        summary: 'List all registered clients',
        security: [{ adminApiKey: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      requireAdmin(request);

      const clients = await listClients();

      return reply.code(200).send(
        clients.map((c) => ({
          client_id: c.client_id,
          client_name: c.client_name,
          client_type: c.client_type,
          redirect_uris: c.redirect_uris,
          grant_types: c.grant_types,
          allowed_scopes: c.allowed_scopes,
          allowed_origins: c.allowed_origins,
          allowed_sign_methods: c.allowed_sign_methods,
          rate_limit: c.rate_limit,
          active: c.active,
          created_at: c.created_at,
        })),
      );
    },
  );

  // PATCH /v1/admin/clients/:client_id — update a client
  fastify.patch(
    '/v1/admin/clients/:client_id',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Update a client',
        security: [{ adminApiKey: [] }],
        params: ClientIdParamsSchema,
        body: UpdateClientBodySchema,
        response: { 400: ErrorResponseSchema },
      },
    },
    async (
      request: FastifyRequest<{
        Params: z.infer<typeof ClientIdParamsSchema>;
        Body: z.infer<typeof UpdateClientBodySchema>;
      }>,
      reply: FastifyReply,
    ) => {
      requireAdmin(request);

      const { client_id } = request.params;
      const body = request.body;

      // Reject empty updates — check key presence, not truthiness
      const hasUpdates =
        'client_name' in body ||
        'redirect_uris' in body ||
        'grant_types' in body ||
        'allowed_scopes' in body ||
        'allowed_origins' in body ||
        'rate_limit' in body;
      if (!hasUpdates) {
        throw new AuthError('No updatable fields provided', 400, 'Bad Request');
      }

      // Validate redirect URIs if provided
      if (body.redirect_uris) {
        for (const uri of body.redirect_uris) {
          validateRedirectUri(uri);
        }
      }

      const normalizedAllowedOrigins = normalizeAllowedOrigins(body.allowed_origins);

      // Fetch existing client for cross-field validation when needed
      const needsExisting =
        body.grant_types || body.redirect_uris || body.allowed_scopes;
      const existing = needsExisting
        ? await getClientById(client_id)
        : null;

      // Validate grant_types vs redirect_uris (both directions)
      const effectiveGrants = body.grant_types ?? existing?.grant_types ?? [];
      const effectiveUris = body.redirect_uris ?? existing?.redirect_uris ?? [];
      const needsCallback = effectiveGrants.some((g) => g === 'authorization_code');
      if (needsCallback && effectiveUris.length === 0) {
        throw new AuthError(
          'redirect_uris required when authorization_code grant is enabled',
          400,
          'Bad Request',
        );
      }

      // Validate scopes if provided
      if (body.allowed_scopes) {
        for (const scope of body.allowed_scopes) {
          if (!validateScopeFormat(scope)) {
            throw new AuthError(`Invalid scope format: ${scope}`, 400, 'Bad Request');
          }
        }

        // Enforce EVM scope restriction
        if (existing?.allowed_sign_methods.includes('evm')) {
          if (body.allowed_scopes.length === 0) {
            throw new AuthError('EVM clients must specify allowed_scopes: ["openid"]', 400, 'Bad Request');
          }
          const nonOpenid = body.allowed_scopes.filter((s) => s !== 'openid');
          if (nonOpenid.length > 0) {
            throw new AuthError('EVM clients can only use the "openid" scope', 400, 'Bad Request');
          }
        }
      }

      const fields: UpdateClientFields = {
        client_name: body.client_name,
        redirect_uris: body.redirect_uris,
        grant_types: body.grant_types,
        allowed_scopes: body.allowed_scopes,
        allowed_origins: normalizedAllowedOrigins,
        rate_limit: body.rate_limit,
      };

      const updated = await updateClient(client_id, fields);
      if (!updated) {
        throw new AuthError('Client not found', 404, 'Not Found');
      }

      return reply.code(200).send({
        client_id: updated.client_id,
        client_name: updated.client_name,
        client_type: updated.client_type,
        redirect_uris: updated.redirect_uris,
        grant_types: updated.grant_types,
        allowed_scopes: updated.allowed_scopes,
        allowed_origins: updated.allowed_origins,
        allowed_sign_methods: updated.allowed_sign_methods,
        rate_limit: updated.rate_limit,
        active: updated.active,
        created_at: updated.created_at,
      });
    },
  );

  // POST /v1/admin/clients/:client_id/rotate-secret — rotate client secret
  fastify.post(
    '/v1/admin/clients/:client_id/rotate-secret',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Rotate client secret (confidential clients only)',
        security: [{ adminApiKey: [] }],
        params: ClientIdParamsSchema,
        response: { 400: ErrorResponseSchema },
      },
    },
    async (
      request: FastifyRequest<{
        Params: z.infer<typeof ClientIdParamsSchema>;
      }>,
      reply: FastifyReply,
    ) => {
      requireAdmin(request);

      const { client_id } = request.params;
      const result = await rotateClientSecret(client_id);

      if (!result) {
        throw new AuthError(
          'Client not found or is not a confidential client',
          404,
          'Not Found',
        );
      }

      return reply.code(200).send({
        client_id: result.client.client_id,
        client_secret: result.client_secret,
        client_name: result.client.client_name,
        message: 'Secret rotated. The old secret is now invalid.',
      });
    },
  );

  // DELETE /v1/admin/clients/:client_id — deactivate a client
  fastify.delete(
    '/v1/admin/clients/:client_id',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Deactivate a client',
        security: [{ adminApiKey: [] }],
        params: ClientIdParamsSchema,
      },
    },
    async (
      request: FastifyRequest<{
        Params: z.infer<typeof ClientIdParamsSchema>;
      }>,
      reply: FastifyReply,
    ) => {
      requireAdmin(request);

      const { client_id } = request.params;
      const deactivated = await deactivateClient(client_id);

      if (!deactivated) {
        throw new AuthError('Client not found', 404, 'Not Found');
      }

      return reply.code(200).send({ status: 'deactivated', client_id });
    },
  );
}
