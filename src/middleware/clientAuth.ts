import { FastifyRequest } from 'fastify';
import { getClientById, verifyClientSecret } from '../db/clients';
import { InvalidClientError } from '../util/errors';
import { OAuthClient } from '../types';

export interface ClientAuthResult {
  client: OAuthClient;
  pkceRequired: boolean;
}

/**
 * Authenticate a client from the request.
 * Checks Basic auth header first, then falls back to POST body client_id/client_secret.
 *
 * - Confidential clients must provide a valid client_secret.
 * - Public clients don't need a secret but PKCE will be required.
 */
export async function authenticateClient(
  request: FastifyRequest<{ Body: { client_id?: string; client_secret?: string } }>,
): Promise<ClientAuthResult> {
  let clientId: string | undefined;
  let clientSecret: string | undefined;

  // Try Basic auth header first
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex > 0) {
      try {
        clientId = decodeURIComponent(decoded.slice(0, colonIndex));
        clientSecret = decodeURIComponent(decoded.slice(colonIndex + 1));
      } catch {
        // Invalid percent-encoding in Basic auth — fall through to POST body
      }
    }
  }

  // Fall back to POST body
  if (!clientId) {
    clientId = request.body?.client_id;
    clientSecret = request.body?.client_secret;
  }

  if (!clientId) {
    throw new InvalidClientError('Missing client_id');
  }

  const client = await getClientById(clientId);
  if (!client) {
    throw new InvalidClientError('Unknown client_id');
  }

  if (client.client_type === 'confidential') {
    if (!clientSecret) {
      throw new InvalidClientError('Missing client_secret for confidential client');
    }
    const valid = await verifyClientSecret(client, clientSecret);
    if (!valid) {
      throw new InvalidClientError('Invalid client_secret');
    }
    return { client, pkceRequired: false };
  }

  // Public client — no secret required, but PKCE is mandatory
  return { client, pkceRequired: true };
}
