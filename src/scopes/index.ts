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

// Sample SS58 address used to validate that wildcard hotkey slots in allowed
// templates substitute into a scope shape that matches the registry regex.
const SS58_PLACEHOLDER = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

function placeholderForTemplateSegment(templateSeg: string): string {
  if (templateSeg === '{hotkey}') return SS58_PLACEHOLDER;
  return '1';
}

/**
 * Validate a single `allowed_scopes` entry as configured by an admin.
 *
 * Accepts either a fully literal scope (existing semantics) or a wildcard
 * template that uses `*` segments. A wildcard entry is structurally valid if
 * its segment shape matches at least one known scope template AND every
 * non-`*` segment of the entry yields a concrete scope that passes
 * `validateScopeFormat` once `*` segments are substituted with a value valid
 * for that template position. This rejects entries like `delegate:*:abc` or
 * `subnet:*:holder:` whose literal segments could never satisfy a real scope.
 */
export function validateAllowedScopeFormat(entry: string): boolean {
  if (!entry.includes('*')) return validateScopeFormat(entry);
  const entrySegs = entry.split(':');
  for (const def of SCOPE_REGISTRY) {
    for (const template of def.templates) {
      const tmplSegs = template.split(':');
      if (tmplSegs.length !== entrySegs.length) continue;
      const concrete: string[] = [];
      let shapeOk = true;
      for (let i = 0; i < tmplSegs.length; i++) {
        const t = tmplSegs[i]!;
        const e = entrySegs[i]!;
        const isParam = t === '*' || (t.startsWith('{') && t.endsWith('}'));
        if (isParam) {
          concrete.push(e === '*' ? placeholderForTemplateSegment(t) : e);
          continue;
        }
        if (e === '*') {
          concrete.push(t);
          continue;
        }
        if (e !== t) {
          shapeOk = false;
          break;
        }
        concrete.push(e);
      }
      if (shapeOk && def.regex.test(concrete.join(':'))) return true;
    }
  }
  return false;
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

/**
 * Match a requested scope against a single allowlist entry.
 *
 * The allowed entry may contain `*` segments, each of which matches exactly one
 * non-empty, non-colon segment of the requested scope. Non-`*` segments must
 * match literally. Segment counts must be equal — `*` does not span segments.
 */
function scopeMatchesAllowed(requestedScope: string, allowedEntry: string): boolean {
  const requested = requestedScope.split(':');
  const allowed = allowedEntry.split(':');
  if (requested.length !== allowed.length) return false;
  for (let i = 0; i < allowed.length; i++) {
    const allowedSeg = allowed[i]!;
    const requestedSeg = requested[i]!;
    if (allowedSeg === '*') {
      if (requestedSeg.length === 0) return false;
      continue;
    }
    if (allowedSeg !== requestedSeg) return false;
  }
  return true;
}

function matchesAnyAllowed(requestedScope: string, allowedScopes: string[]): boolean {
  return allowedScopes.some((entry) => scopeMatchesAllowed(requestedScope, entry));
}

/**
 * Returns true if a requested scope is permitted by a client's `allowed_scopes`.
 *
 * An empty allowlist short-circuits to permit every scope (no client-side
 * enforcement). Metadata scopes (e.g. `openid`) always pass. Otherwise the
 * scope is checked literally and via wildcard entries in the allowlist; for
 * amount-bearing scopes, the amount-stripped base scope is also checked
 * against the allowlist (literal and wildcard) to allow a base entry like
 * `subnet:1:holder` to permit `subnet:1:holder:100`.
 */
export function isScopeAllowedForClient(requestedScope: string, allowedScopes: string[]): boolean {
  if (allowedScopes.length === 0) return true;
  if (METADATA_SCOPES.has(requestedScope)) return true;
  if (matchesAnyAllowed(requestedScope, allowedScopes)) return true;

  let parsed: ParsedScope;
  try {
    parsed = parseScope(requestedScope);
  } catch {
    return false;
  }
  if (parsed.minAmount === undefined) return false;

  let baseScope: string | undefined;
  if (parsed.type === 'subnet') {
    baseScope = `subnet:${parsed.netuid}:${parsed.role}`;
  } else if (parsed.type === 'tao') {
    baseScope = 'tao:holder';
  } else if (parsed.type === 'delegate' && parsed.hotkey) {
    baseScope = `delegate:${parsed.hotkey}`;
  }
  return baseScope !== undefined && matchesAnyAllowed(baseScope, allowedScopes);
}

export function enforceClientScopes(requestedScopes: string[], allowedScopes: string[]): void {
  if (allowedScopes.length === 0) return;
  for (const scope of requestedScopes) {
    if (!isScopeAllowedForClient(scope, allowedScopes)) {
      throw new AuthError(`Scope "${scope}" is not allowed for this client`, 403, 'Forbidden');
    }
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
