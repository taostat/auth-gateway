import { ScopeHandler } from './types';
import { minerHandler } from './miner';
import { validatorHandler } from './validator';
import { ownerHandler } from './owner';
import { holderHandler } from './holder';
import { AuthError, InvalidScopeFormatError, ScopeError } from '../util/errors';
import { SignerContext } from './signerContext';

export { SignerContext, resolveSignerContext } from './signerContext';

const SCOPE_REGEX = /^subnet:(\d+):(miner|owner|validator|holder)$/;

const handlers: Record<string, ScopeHandler> = {
  miner: minerHandler,
  validator: validatorHandler,
  owner: ownerHandler,
  holder: holderHandler,
};

export function parseScope(scope: string): { netuid: number; role: string } {
  const match = scope.match(SCOPE_REGEX);
  if (!match) {
    throw new InvalidScopeFormatError(scope);
  }
  return { netuid: parseInt(match[1], 10), role: match[2] };
}

export function validateScopeFormat(scope: string): boolean {
  return SCOPE_REGEX.test(scope);
}

export function validateScopes(scopes: string[]): void {
  for (const scope of scopes) {
    if (!validateScopeFormat(scope)) {
      throw new InvalidScopeFormatError(scope);
    }
  }
}

const roleDescriptions: Record<string, string> = {
  miner: 'Miner',
  validator: 'Validator',
  owner: 'Owner',
  holder: 'Token Holder',
};

/**
 * Human-readable description of a scope string.
 * e.g. "subnet:1:validator" → "Validator on Subnet 1"
 */
export function describeScope(scope: string): string {
  const match = scope.match(SCOPE_REGEX);
  if (!match) return scope;
  const netuid = match[1];
  const role = roleDescriptions[match[2]] || match[2];
  return `${role} on Subnet ${netuid}`;
}

/**
 * Describe a list of scopes as human-readable strings.
 */
export function describeScopes(scopes: string[]): string[] {
  return scopes.map(describeScope);
}

/**
 * Enforce that all requested scopes are within the client's allowed_scopes.
 * If allowed_scopes is empty, all scopes are permitted (unrestricted).
 */
export function enforceClientScopes(requestedScopes: string[], allowedScopes: string[]): void {
  if (allowedScopes.length === 0) return;
  for (const scope of requestedScopes) {
    if (!allowedScopes.includes(scope)) {
      throw new AuthError(`Scope "${scope}" is not allowed for this client`, 403, 'Forbidden');
    }
  }
}

/**
 * Verify all scopes using a resolved signer context.
 * Throws ScopeError (403) if ANY scope fails.
 */
export async function verifyScopes(ctx: SignerContext, scopes: string[]): Promise<void> {
  for (const scope of scopes) {
    const { netuid, role } = parseScope(scope);
    const handler = handlers[role];
    if (!handler) {
      throw new InvalidScopeFormatError(scope);
    }
    const result = await handler.verify(ctx, { netuid });
    if (!result) {
      throw new ScopeError(scope);
    }
  }
}
