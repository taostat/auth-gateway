import { ParsedScope } from './types';
import { config } from '../config';
import { AuthError, InvalidScopeFormatError, ScopeError } from '../util/errors';
import { SignerContext } from './signerContext';
import { SignMethod } from '../crypto/address';
import { SCOPE_REGISTRY, ScopeDefinition } from './registry';

export { type ParsedScope } from './types';
export { type SignerContext, resolveSignerContext, resolveEvmSignerContext } from './signerContext';

const METADATA_SCOPES = new Set(['openid']);

const RAO_PER_UNIT = BigInt(1e9);

function raoToDisplay(rao: bigint): string {
  const whole = rao / RAO_PER_UNIT;
  const frac = rao % RAO_PER_UNIT;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

function findDef(scope: string): ScopeDefinition | undefined {
  return SCOPE_REGISTRY.find((def) => def.regex.test(scope));
}

function parseScopeWithDef(scope: string): { def: ScopeDefinition; parsed: ParsedScope } {
  for (const def of SCOPE_REGISTRY) {
    const match = scope.match(def.regex);
    if (match) return { def, parsed: def.parse(match) };
  }
  throw new InvalidScopeFormatError(scope);
}

export function parseScope(scope: string): ParsedScope {
  return parseScopeWithDef(scope).parsed;
}

export function validateScopeFormat(scope: string): boolean {
  if (METADATA_SCOPES.has(scope)) return true;
  return findDef(scope) !== undefined;
}

export function validateScopes(scopes: string[]): void {
  for (const scope of scopes) {
    if (METADATA_SCOPES.has(scope)) continue;
    const def = findDef(scope);
    if (!def) throw new InvalidScopeFormatError(scope);
    if (!def.testnet_supported && config.isTestnet) {
      throw new AuthError(`Scope "${scope}" requires Taostats API (mainnet only)`, 400, 'Bad Request');
    }
  }
}

const roleDescriptions: Record<string, string> = {
  miner: 'Miner',
  validator: 'Validator',
  owner: 'Owner',
  holder: 'Token Holder',
};

export function describeScope(scope: string): string {
  if (METADATA_SCOPES.has(scope)) return scope;

  try {
    const p = parseScope(scope);

    if (p.type === 'subnet') {
      const role = roleDescriptions[p.role] || p.role;
      const suffix = p.minAmount !== undefined ? ` (min ${raoToDisplay(p.minAmount)} alpha)` : '';
      return `${role} on Subnet ${p.netuid}${suffix}`;
    }

    if (p.type === 'tao') {
      const suffix = p.minAmount !== undefined ? ` (min ${raoToDisplay(p.minAmount)} TAO)` : '';
      return `TAO Holder${suffix}`;
    }

    if (p.type === 'delegate' && p.hotkey) {
      const short = `${p.hotkey.slice(0, 8)}...${p.hotkey.slice(-6)}`;
      const suffix = p.minAmount !== undefined ? ` (min ${raoToDisplay(p.minAmount)} TAO)` : '';
      return `Delegator to ${short}${suffix}`;
    }

    if (p.type === 'staker' && p.minAmount !== undefined) {
      return `Staker (min ${raoToDisplay(p.minAmount)} TAO total)`;
    }

    return scope;
  } catch {
    return scope;
  }
}

export function describeScopes(scopes: string[]): string[] {
  return scopes.map(describeScope);
}

export function enforceClientScopes(requestedScopes: string[], allowedScopes: string[]): void {
  if (allowedScopes.length === 0) return;
  for (const scope of requestedScopes) {
    if (METADATA_SCOPES.has(scope)) continue;
    if (allowedScopes.includes(scope)) continue;

    const parsed = parseScope(scope);
    if (parsed.minAmount !== undefined) {
      let baseScope: string | undefined;
      if (parsed.type === 'subnet') {
        baseScope = `subnet:${parsed.netuid}:${parsed.role}`;
      } else if (parsed.type === 'tao') {
        baseScope = 'tao:holder';
      } else if (parsed.type === 'delegate' && parsed.hotkey) {
        baseScope = `delegate:${parsed.hotkey}`;
      }
      if (baseScope && allowedScopes.includes(baseScope)) continue;
    }

    throw new AuthError(`Scope "${scope}" is not allowed for this client`, 403, 'Forbidden');
  }
}

export async function verifyScopes(ctx: SignerContext, scopes: string[]): Promise<void> {
  for (const scope of scopes) {
    if (METADATA_SCOPES.has(scope)) continue;

    const { def, parsed } = parseScopeWithDef(scope);

    const handler = def.handlers[parsed.role];
    if (!handler) throw new InvalidScopeFormatError(`unknown role: ${parsed.role}`);

    const result = await handler.verify(ctx, parsed);
    if (!result) throw new ScopeError(scope);
  }
}

const EVM_ALLOWED_SCOPES = new Set(['openid']);

export function validateScopesForSignMethod(scopes: string[], method: SignMethod): void {
  if (method !== 'evm') return;
  for (const scope of scopes) {
    if (!EVM_ALLOWED_SCOPES.has(scope)) {
      throw new AuthError(`Scope "${scope}" is not available for EVM wallets`, 400, 'Bad Request');
    }
  }
}
