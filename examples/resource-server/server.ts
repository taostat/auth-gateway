import express, { Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const AUTH_GATEWAY_URL = process.env.AUTH_GATEWAY_URL || 'http://localhost:3000';
const PORT = parseInt(process.env.PORT || '4000', 10);
const REQUIRED_SCOPE = process.env.REQUIRED_SCOPE;

const JWKS = createRemoteJWKSet(
  new URL('/.well-known/jwks.json', AUTH_GATEWAY_URL)
);

const issuer = (() => {
  try {
    return new URL(AUTH_GATEWAY_URL).origin;
  } catch {
    return 'https://auth.taostats.io';
  }
})();

const audience = process.env.JWT_AUDIENCE || 'bittensor-apps';

const app = express();

app.get('/public', (_req: Request, res: Response) => {
  res.json({
    message: 'This is a public endpoint',
    timestamp: new Date().toISOString(),
  });
});

app.get('/protected', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Missing or malformed Authorization header',
    });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer,
      audience,
    });

    if (REQUIRED_SCOPE) {
      const scopes = Array.isArray(payload.scopes) ? payload.scopes : [];
      if (!scopes.includes(REQUIRED_SCOPE)) {
        res.status(403).json({
          error: 'forbidden',
          message: `Missing required scope: ${REQUIRED_SCOPE}`,
        });
        return;
      }
    }

    res.json({
      message: 'Access granted',
      claims: payload,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Token verification failed';
    res.status(401).json({
      error: 'unauthorized',
      message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Resource server listening on port ${PORT}`);
  console.log(`Auth gateway URL: ${AUTH_GATEWAY_URL}`);
  console.log(`Issuer: ${issuer}`);
  console.log(`Audience: ${audience}`);
  if (REQUIRED_SCOPE) {
    console.log(`Required scope: ${REQUIRED_SCOPE}`);
  }
});
