import crypto from 'crypto';
import { FastifyReply } from 'fastify';
import { getEpochDetails } from '../../subtensor/queries';
import { config } from '../../config';
import { escapeHtml } from '../../util/html';
import { cssLinks } from '../../styles';

export function errorPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Taostats Auth - Error</title>
  ${cssLinks}
</head>
<body class="narrow">
  <h1 style="color:var(--error);">${escapeHtml(title)}</h1>
  <div class="error-box">${escapeHtml(message)}</div>
</body>
</html>`;
}

export function generateNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

export function applyHtmlSecurityHeaders(reply: FastifyReply, nonce?: string): FastifyReply {
  const scriptSrc = nonce ? `'self' 'nonce-${nonce}'` : "'self' 'unsafe-inline'";
  reply
    .header(
      'Content-Security-Policy',
      `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    )
    .header('X-Frame-Options', 'DENY')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Referrer-Policy', 'no-referrer');
  if (config.nodeEnv === 'production') {
    reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
  return reply;
}

export function sendHtmlError(reply: FastifyReply, statusCode: number, title: string, message: string): FastifyReply {
  return applyHtmlSecurityHeaders(reply)
    .header('Content-Type', 'text/html')
    .code(statusCode)
    .send(errorPage(title, message));
}

/** Minimum access token expiry in seconds (floor for epoch-aligned expiry). */
export const MIN_ACCESS_TOKEN_EXPIRY = 60;

/**
 * Extract the first netuid from a scopes array.
 * Scopes follow the format "role:netuid:..." (e.g. "subnet:1:miner").
 */
function firstNetuid(scopes: string[]): number | null {
  for (const scope of scopes) {
    const parts = scope.split(':');
    const netuidStr = parts[1];
    if (parts.length >= 2 && netuidStr) {
      const netuid = parseInt(netuidStr, 10);
      if (!isNaN(netuid)) return netuid;
    }
  }
  return null;
}

/**
 * Get both epoch-aligned access token expiry and current epoch number
 * for the first netuid in scopes. Single set of RPC calls.
 */
export async function getEpochInfo(scopes: string[]): Promise<{
  accessExpiry: number;
  epoch: number | null;
}> {
  const netuid = firstNetuid(scopes);
  if (netuid === null) {
    return { accessExpiry: config.jwtAccessTokenExpiry, epoch: null };
  }

  const { secondsUntilNextEpoch, currentEpoch } = await getEpochDetails(netuid);

  let accessExpiry: number;
  if (secondsUntilNextEpoch !== null && secondsUntilNextEpoch >= MIN_ACCESS_TOKEN_EXPIRY) {
    accessExpiry = secondsUntilNextEpoch;
  } else if (secondsUntilNextEpoch !== null) {
    accessExpiry = MIN_ACCESS_TOKEN_EXPIRY;
  } else {
    accessExpiry = config.jwtAccessTokenExpiry;
  }

  return { accessExpiry, epoch: currentEpoch };
}

/**
 * Extract the first netuid from scopes and compute epoch-aligned access token expiry.
 * Falls back to config.jwtAccessTokenExpiry if epoch info is unavailable.
 */
export async function getAccessTokenExpiry(scopes: string[]): Promise<number> {
  const { accessExpiry } = await getEpochInfo(scopes);
  return accessExpiry;
}

/**
 * Get the current epoch for the first netuid in scopes.
 * Used for storing epoch_at_issuance on refresh tokens.
 */
export async function getFirstEpoch(scopes: string[]): Promise<number | null> {
  const { epoch } = await getEpochInfo(scopes);
  return epoch;
}
