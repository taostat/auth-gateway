import Fastify, { FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import {
  validatorCompiler,
  serializerCompiler,
} from 'fastify-type-provider-zod';
import { registerRoutes } from '../../routes';
import { createErrorHandler } from '../../errorHandler';

export async function buildTestApp(): Promise<FastifyInstance> {
  const { loadKeys } = require('../../crypto/keys');
  loadKeys();

  const server = Fastify({ logger: false });

  // Set Zod validation compilers
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  await server.register(formbody);

  server.setErrorHandler(createErrorHandler({
    hideInternalErrors: false,
    logErrors: false,
  }));

  await registerRoutes(server);
  await server.ready();
  return server;
}
