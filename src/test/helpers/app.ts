import Fastify, { FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { registerRoutes } from '../../routes';
import { createErrorHandler } from '../../errorHandler';

export const TEST_BROWSER_ORIGIN = 'http://localhost:3000';

export function withSameOrigin<T extends { headers?: Record<string, string> }>(
  request: T,
  origin: string = TEST_BROWSER_ORIGIN,
): T {
  return {
    ...request,
    headers: {
      ...request.headers,
      origin,
    },
  };
}

export function browserInject(
  app: FastifyInstance,
  request: { method: string; url: string; payload?: unknown; headers?: Record<string, string> },
) {
  return app.inject(withSameOrigin(request));
}

export function browserPost(app: FastifyInstance, url: string, payload?: unknown, headers?: Record<string, string>) {
  return browserInject(app, {
    method: 'POST',
    url,
    ...(payload !== undefined ? { payload } : {}),
    ...(headers ? { headers } : {}),
  });
}

export function browserGet(app: FastifyInstance, url: string, headers?: Record<string, string>) {
  return browserInject(app, {
    method: 'GET',
    url,
    ...(headers ? { headers } : {}),
  });
}

export async function buildTestApp(): Promise<FastifyInstance> {
  const { loadKeys } = require('../../crypto/keys');
  loadKeys();

  const server = Fastify({ logger: false });

  // Set Zod validation compilers
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  await server.register(formbody);

  server.setErrorHandler(
    createErrorHandler({
      hideInternalErrors: false,
      logErrors: false,
    }),
  );

  await registerRoutes(server);
  await server.ready();
  return server;
}
