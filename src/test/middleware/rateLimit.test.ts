import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import { registerRateLimit } from '../../middleware/rateLimit';

async function buildRateLimitedApp(
  trustProxy: NonNullable<FastifyServerOptions['trustProxy']>,
  max: number,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy });
  await registerRateLimit(app);
  for (const url of ['/v1/auth/challenge', '/v1/auth/verify']) {
    app.post(url, { config: { rateLimit: { max, timeWindow: '1 minute' } } }, async (_request, reply) =>
      reply.code(200).send({ ok: true }),
    );
  }
  await app.ready();
  return app;
}

describe.each(['/v1/auth/challenge', '/v1/auth/verify'])('rate limit client IP selection for %s', (url) => {
  test('uses the forwarded end-client IP and ignores body client_id', async () => {
    const app = await buildRateLimitedApp(true, 2);
    try {
      const headers = { 'x-forwarded-for': '198.51.100.10' };
      for (const clientId of ['client-a', 'client-b']) {
        const response = await app.inject({
          method: 'POST',
          url,
          headers,
          payload: { client_id: clientId },
        });
        expect(response.statusCode).toBe(200);
      }
      const exhausted = await app.inject({
        method: 'POST',
        url,
        headers,
        payload: { client_id: 'client-c' },
      });
      expect(exhausted.statusCode).toBe(429);
      expect(Number(exhausted.headers['retry-after'])).toBeGreaterThan(0);

      const otherClient = await app.inject({
        method: 'POST',
        url,
        headers: { 'x-forwarded-for': '198.51.100.11' },
        payload: { client_id: 'client-a' },
      });
      expect(otherClient.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  test('uses the socket IP when proxy trust is disabled', async () => {
    const app = await buildRateLimitedApp(false, 1);
    try {
      const first = await app.inject({
        method: 'POST',
        url,
        headers: { 'x-forwarded-for': '198.51.100.10' },
      });
      const second = await app.inject({
        method: 'POST',
        url,
        headers: { 'x-forwarded-for': '198.51.100.11' },
      });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  test('trusts allowlisted proxy CIDRs and stops at the first untrusted hop', async () => {
    const app = await buildRateLimitedApp(['10.0.0.0/8', '192.0.2.20'], 1);
    try {
      const send = (forwarded: string, remoteAddress = '10.0.0.2') =>
        app.inject({
          method: 'POST',
          url,
          remoteAddress,
          headers: { 'x-forwarded-for': forwarded },
        });
      expect((await send('198.51.100.10, 192.0.2.20')).statusCode).toBe(200);
      expect((await send('198.51.100.11, 192.0.2.20')).statusCode).toBe(200);
      expect((await send('203.0.113.1, 198.51.100.10, 192.0.2.20')).statusCode).toBe(429);
      // Direct callers outside the allowlist are keyed by their socket IP.
      expect((await send('203.0.113.2', '198.51.100.30')).statusCode).toBe(200);
      expect((await send('203.0.113.3', '198.51.100.30')).statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});
