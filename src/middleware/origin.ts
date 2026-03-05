/**
 * Origin enforcement operates at three layers:
 *
 * 1. CORS plugin (index.ts)          — browser preflight; allows origins from any active client's allowed_origins
 * 2. enforceAllowedOriginForClient() — per-client origin check on token/device-code endpoints
 * 3. enforceSameOrigin()             — restricts browser-only endpoints (oauth challenge/callback,
 *                                      device approve/confirm/scopes) to the gateway's own origin
 *                                      or the configured VERIFICATION_URI origin
 */
import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config';
import { AuthError } from '../util/errors';

function normalizeOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AuthError(`Invalid origin: ${value}`, 400, 'Bad Request');
  }

  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
    throw new AuthError(`Invalid origin: ${value}`, 400, 'Bad Request');
  }

  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new AuthError('allowed_origins entries must be origin-only URLs', 400, 'Bad Request');
  }

  return parsed.origin;
}

function requestOrigin(request: FastifyRequest): string | null {
  const header = request.headers.origin;
  if (!header) return null;
  return normalizeOrigin(header);
}

const cachedGatewayOrigin = new URL(config.publicUrl).origin;
const cachedVerificationOrigin = new URL(config.verificationUri).origin;

export function gatewayOrigin(): string {
  return cachedGatewayOrigin;
}

export function normalizeAllowedOrigin(origin: string): string {
  return normalizeOrigin(origin);
}

export function normalizeAllowedOrigins(origins: string[] | undefined): string[] | undefined {
  return origins?.map(normalizeAllowedOrigin);
}

export function enforceAllowedOriginForClient(request: FastifyRequest, allowedOrigins: string[]): void {
  const origin = requestOrigin(request);
  if (!origin) return;

  // allowedOrigins are normalized at write time (admin create/update)
  if (!allowedOrigins.includes(origin)) {
    throw new AuthError('Origin not allowed for this client', 403, 'Forbidden');
  }
}

export function enforceSameOrigin(request: FastifyRequest): void {
  const origin = requestOrigin(request);

  // Fail closed: browser-only endpoints must include an Origin header
  if (!origin) {
    throw new AuthError('Origin header required', 403, 'Forbidden');
  }

  if (origin !== cachedGatewayOrigin && origin !== cachedVerificationOrigin) {
    throw new AuthError('Cross-origin request not allowed for this endpoint', 403, 'Forbidden');
  }
}

export async function sameOriginPreHandler(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  enforceSameOrigin(request);
}
