import { randomUUID } from 'node:crypto';
import { ChallengeBindings } from '../types';

export function buildChallengeNonce(scopes: string[], bindings?: ChallengeBindings): string {
  const nonceId = randomUUID();
  const scopesCsv = scopes.length > 0 ? scopes.join(',') : 'none';

  if (bindings?.clientId && bindings.purpose) {
    return `taostats-auth:${bindings.purpose}:${bindings.clientId}:${bindings.context ?? '-'}:${nonceId}`;
  }

  return `taostats-auth:${scopesCsv}:${nonceId}`;
}
