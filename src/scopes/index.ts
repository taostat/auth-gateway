import { ParsedScope } from './types';
import { config } from '../config';
import { AuthError, InvalidScopeFormatError, ScopeError } from '../util/errors';
import { SignerContext } from './signerContext';
import { SignMethod } from '../crypto/address';
import { SCOPE_REGISTRY, ScopeDefinition } from './registry';

export { type ParsedScope } from './types';
export { type SignerContext, resolveSignerContext, resolveEvmSignerContext } from './signerContext';

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

function supportsSignMethod(def: ScopeDefinition, method: SignMethod): boolean {
  return def.supportsSignMethod ? def.supportsSignMethod(method) : def.sign_methods.includes(method);
}

export function parseScope(scope: string): ParsedScope {
  return parseScopeWithDef(scope).parsed;
}

export function validateScopeFormat(scope: string): boolean {
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
 * Accepts either a fully literal scope or a wildcard template that uses `*`
 * segments. A wildcard entry is structurally valid if its segment shape
 * matches at least one known scope template AND every non-`*` segment yields
 * a concrete scope that passes `validateScopeFormat` once `*` segments are
 * substituted with a value valid for that template position. This rejects
 * entries like `delegate:*:abc` or `subnet:*:holder:` whose literal segments
 * could never satisfy a real scope.
 */
export function validateAllowedScopeFormat(entry: string): boolean {
  if (!entry.includes('*')) return validateScopeFormat(entry);
  const entrySegs = entry.split(':');
  for (const def of SCOPE_REGISTRY) {
    if (def.isMetadata) continue;
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
    const def = findDef(scope);
    if (!def) throw new InvalidScopeFormatError(scope);
    if (def.isMetadata) continue;
    if (!def.testnet_supported && config.isTestnet) {
      throw new AuthError(`Scope "${scope}" requires Taostats API (mainnet only)`, 400, 'Bad Request');
    }
  }
}

export function describeScope(scope: string): string {
  try {
    const { def, parsed } = parseScopeWithDef(scope);
    return def.describe(parsed);
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

  let parsed: ParsedScope;
  let def: ScopeDefinition;
  try {
    const r = parseScopeWithDef(requestedScope);
    parsed = r.parsed;
    def = r.def;
  } catch {
    return false;
  }
  if (def.isMetadata) return true;

  if (matchesAnyAllowed(requestedScope, allowedScopes)) return true;
  if (parsed.minAmount === undefined) return false;

  const base = def.baseScope(parsed);
  return base !== undefined && matchesAnyAllowed(base, allowedScopes);
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
    const { def, parsed } = parseScopeWithDef(scope);
    if (def.isMetadata) continue;

    const handler = def.handlers[parsed.role];
    if (!handler) throw new InvalidScopeFormatError(`unknown role: ${parsed.role}`);

    const result = await handler.verify(ctx, parsed);
    if (!result) throw new ScopeError(scope);
  }
}

export function validateScopesForSignMethod(scopes: string[], method: SignMethod): void {
  for (const scope of scopes) {
    const def = findDef(scope);
    if (!def) continue;
    if (!supportsSignMethod(def, method)) {
      throw new AuthError(
        `Scope "${scope}" is not available for ${method.toUpperCase()} wallets`,
        400,
        'Bad Request',
      );
    }
  }
}
