import Fastify, { FastifyInstance } from 'fastify';
import { register } from './registry';
import { config } from '../config';

export function createMetricsServer(): FastifyInstance {
  const server = Fastify({
    logger: { level: config.nodeEnv === 'production' ? 'info' : 'warn' },
  });

  server.get('/metrics', async (_request, reply) => {
    const body = await register.metrics();
    return reply.header('Content-Type', register.contentType).send(body);
  });

  server.get('/health', async (_request, reply) => {
    return reply.code(200).send({ status: 'ok' });
  });

  return server;
}
