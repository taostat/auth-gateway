import { FastifyInstance } from 'fastify';
import { authorizeRoutes } from './authorize';
import { tokenRoutes } from './token';

export async function oauthRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(authorizeRoutes);
  await fastify.register(tokenRoutes);
}
