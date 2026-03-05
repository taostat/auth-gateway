import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from '../config';
import { createClient, listClients, deactivateClient } from '../db/clients';
import { AdminAuthError, AuthError } from '../util/errors';
import { CreateClientBodySchema, ClientIdParamsSchema } from '../schemas/admin';
import { ErrorResponseSchema } from '../schemas/responses';

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
  fastify.post('/v1/admin/clients', {
    schema: {
      tags: ['Admin'],
      summary: 'Register a new OAuth client',
      security: [{ adminApiKey: [] }],
      body: CreateClientBodySchema,
      response: { 400: ErrorResponseSchema },
    },
  }, async (request: FastifyRequest<{
    Body: z.infer<typeof CreateClientBodySchema>;
  }>, reply: FastifyReply) => {
    requireAdmin(request);

    const { client_name, client_type, redirect_uris, grant_types, allowed_scopes, allowed_origins, rate_limit } = request.body;

    const CALLBACK_GRANTS = new Set([
      'authorization_code',
    ]);
    const needsCallback = Array.isArray(grant_types)
      && grant_types.some((g) => CALLBACK_GRANTS.has(g));

    if (needsCallback && (!Array.isArray(redirect_uris) || redirect_uris.length === 0)) {
      throw new AuthError('redirect_uris required unless grant type is device_code only', 400, 'Bad Request');
    }

    // Validate each redirect_uri
    for (const uri of redirect_uris) {
      validateRedirectUri(uri);
    }

    const result = await createClient({
      client_name,
      client_type,
      redirect_uris,
      grant_types,
      allowed_scopes,
      allowed_origins,
      rate_limit,
    });

    return reply.code(201).send({
      client_id: result.client.client_id,
      client_secret: result.client_secret, // Only returned once, on creation
      client_name: result.client.client_name,
      client_type: result.client.client_type,
      redirect_uris: result.client.redirect_uris,
      grant_types: result.client.grant_types,
      allowed_scopes: result.client.allowed_scopes,
      allowed_origins: result.client.allowed_origins,
      rate_limit: result.client.rate_limit,
    });
  });

  // GET /v1/admin/clients — list all registered clients
  fastify.get('/v1/admin/clients', {
    schema: {
      tags: ['Admin'],
      summary: 'List all registered clients',
      security: [{ adminApiKey: [] }],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
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
        rate_limit: c.rate_limit,
        active: c.active,
        created_at: c.created_at,
      })),
    );
  });

  // DELETE /v1/admin/clients/:client_id — deactivate a client
  fastify.delete('/v1/admin/clients/:client_id', {
    schema: {
      tags: ['Admin'],
      summary: 'Deactivate a client',
      security: [{ adminApiKey: [] }],
      params: ClientIdParamsSchema,
    },
  }, async (request: FastifyRequest<{
    Params: z.infer<typeof ClientIdParamsSchema>;
  }>, reply: FastifyReply) => {
    requireAdmin(request);

    const { client_id } = request.params;
    const deactivated = await deactivateClient(client_id);

    if (!deactivated) {
      throw new AuthError('Client not found', 404, 'Not Found');
    }

    return reply.code(200).send({ status: 'deactivated', client_id });
  });
}
