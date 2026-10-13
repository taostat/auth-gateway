import rateLimit from '@fastify/rate-limit';
import { FastifyInstance } from 'fastify';
import { config } from '../config';

export async function registerRateLimit(server: FastifyInstance): Promise<void> {
  await server.register(rateLimit, {
    max: config.rateLimitGlobal,
    timeWindow: '1 minute',
  });
}
