import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config';

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
        grant_types_supported: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
        scopes_supported: [
          'openid',
          'subnet:*:miner',
          'subnet:*:validator',
          'subnet:*:owner',
          'subnet:*:holder',
          'subnet:*:holder:{min_alpha}',
          'tao:holder',
          'tao:holder:{min_tao}',
          ...(config.isTestnet ? [] : ['delegate:{hotkey}', 'delegate:{hotkey}:{min_tao}', 'staker:{min_tao}']),
        ],
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
}
