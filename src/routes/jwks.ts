import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getJwks } from '../crypto/keys';

export async function jwksRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /.well-known/jwks.json — no rate limit (cacheable, read-only)
  fastify.get('/.well-known/jwks.json', {
    schema: {
      tags: ['Discovery'],
      summary: 'JSON Web Key Set',
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const jwks = getJwks();
    return reply
      .header('Cache-Control', 'public, max-age=3600')
      .code(200)
      .send(jwks);
  });
}
