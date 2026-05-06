import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config';
import { SCOPE_REGISTRY, GRANT_TYPES, getScopeConfig } from '../scopes/registry';

let cachedScopesSupported: string[] | null = null;

function getScopesSupported(): string[] {
  if (!cachedScopesSupported) {
    const scopes: string[] = [];
    for (const def of SCOPE_REGISTRY) {
      if (!def.testnet_supported && config.isTestnet) continue;
      scopes.push(...def.templates);
    }
    cachedScopesSupported = scopes;
  }
  return cachedScopesSupported;
}

export async function discoveryRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /.well-known/openid-configuration — OAuth 2.0 authorization server metadata
  fastify.get(
    '/.well-known/openid-configuration',
    {
      schema: {
        tags: ['Discovery'],
        summary: 'OAuth 2.0 authorization server metadata (RFC 8414)',
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const issuer = config.publicUrl;

      const document = {
        issuer: config.jwtIssuer,
        authorization_endpoint: `${issuer}/v1/oauth/authorize`,
        token_endpoint: `${issuer}/v1/oauth/token`,
        device_authorization_endpoint: `${issuer}/v1/device/code`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
        response_types_supported: ['code'],
        grant_types_supported: GRANT_TYPES.map((g) => g.id),
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
        scopes_supported: getScopesSupported(),
        code_challenge_methods_supported: ['S256'],
        id_token_signing_alg_values_supported: ['RS256'],
        subject_types_supported: ['public'],
        sign_methods_supported: ['sr25519', 'evm'],
        claims_supported: [
          'sub',
          'iss',
          'aud',
          'exp',
          'iat',
          'auth_time',
          'nonce',
          'at_hash',
          'scope',
          'hotkey',
          'coldkey',
          'evm_address',
          'client_id',
        ],
        service_documentation: `${issuer}/docs`,
      };

      return reply
        .header('Content-Type', 'application/json')
        .header('Cache-Control', 'public, max-age=3600')
        .code(200)
        .send(document);
    },
  );

  // GET /v1/discovery/scope-config — scope categories, grant types, sign methods
  fastify.get(
    '/v1/discovery/scope-config',
    {
      schema: {
        tags: ['Discovery'],
        summary: 'OAuth client configuration metadata for scope builder UI',
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply
        .header('Cache-Control', 'public, max-age=3600')
        .code(200)
        .send(getScopeConfig());
    },
  );
}
