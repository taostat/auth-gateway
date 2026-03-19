import { FastifyInstance } from 'fastify';
import { authRoutes } from './auth';
import { oauthRoutes } from './oauth';
import { deviceRoutes } from './device';
import { jwksRoutes } from './jwks';
import { healthRoutes } from './health';
import { adminRoutes } from './admin';
import { discoveryRoutes } from './discovery';
import { landingRoutes } from './landing';

export async function registerRoutes(
  fastify: FastifyInstance,
  opts?: { excludeAdmin?: boolean | undefined } | undefined,
): Promise<void> {
  await fastify.register(authRoutes);
  await fastify.register(oauthRoutes);
  await fastify.register(deviceRoutes);
  await fastify.register(jwksRoutes);
  await fastify.register(healthRoutes);
  if (!opts?.excludeAdmin) {
    await fastify.register(adminRoutes);
  }
  await fastify.register(discoveryRoutes);
  await fastify.register(landingRoutes);
}

export async function registerAdminRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  await fastify.register(adminRoutes);
  await fastify.register(healthRoutes);
}
