import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { isSubtensorConnected } from '../subtensor/client';
import { getPool } from '../db/pool';
import { config } from '../config';
import { HealthResponseSchema } from '../schemas/responses';
import { HealthResponse } from '../types';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /health — no rate limit
  fastify.get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        summary: 'Health check',
        response: { 200: HealthResponseSchema, 503: HealthResponseSchema },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const subtensor = isSubtensorConnected();

      let dbOk = false;
      try {
        await getPool().query('SELECT 1');
        dbOk = true;
      } catch {
        /* DB unavailable */
      }

      const response: HealthResponse = {
        status: subtensor && dbOk ? 'ok' : 'degraded',
        network: config.network,
        subtensor,
        database: dbOk,
        uptime: process.uptime(),
      };
      return reply.code(response.status === 'ok' ? 200 : 503).send(response);
    },
  );
}
