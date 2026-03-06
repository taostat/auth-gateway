import { ScopeHandler, ScopeParams } from './types';
import { minerHandler } from './miner';
import { validatorHandler } from './validator';
import { ownerHandler } from './owner';
import { holderHandler } from './holder';
import { taoHolderHandler } from './taoHolder';
import { delegateHandler } from './delegate';
import { stakerHandler } from './staker';
import { AuthError, InvalidScopeFormatError, ScopeError } from '../util/errors';
import { SignerContext } from './signerContext';

export { type SignerContext, resolveSignerContext } from './signerContext';

// subnet:{netuid}:{role} (no amount) for miner/validator/owner
const SUBNET_ROLE_REGEX = /^subnet:(\d+):(miner|owner|validator)$/;
// subnet:{netuid}:holder or subnet:{netuid}:holder:{min_alpha}
const SUBNET_HOLDER_REGEX = /^subnet:(\d+):holder(?::(\d+))?$/;
// tao:holder or tao:holder:{min_tao}
const TAO_SCOPE_REGEX = /^tao:holder(?::(\d+))?$/;
// delegate:{hotkey_ss58} or delegate:{hotkey_ss58}:{min_tao}
const DELEGATE_SCOPE_REGEX = /^delegate:(5[1-9A-HJ-NP-Za-km-z]{47})(?::(\d+))?$/;
// staker:{min_tao}
const STAKER_SCOPE_REGEX = /^staker:(\d+)$/;
const METADATA_SCOPES = new Set(['openid']);

const RAO_PER_UNIT = BigInt(1e9);

const subnetHandlers: Record<string, ScopeHandler> = {
  miner: minerHandler,
  validator: validatorHandler,
  owner: ownerHandler,
  holder: holderHandler,
};

export interface ParsedScope {
  type: 'subnet' | 'tao' | 'delegate' | 'staker';
  role: string;
  netuid: number;
  minAmount?: bigint | undefined;
  hotkey?: string | undefined;
}

function optionalAmount(raw: string | undefined): bigint | undefined {
  return raw !== undefined ? BigInt(raw) * RAO_PER_UNIT : undefined;
}

export function parseScope(scope: string): ParsedScope {
  const roleMatch = scope.match(SUBNET_ROLE_REGEX);
  if (roleMatch) {
    return {
      type: 'subnet',
      netuid: parseInt(roleMatch[1]!, 10),
      role: roleMatch[2]!,
    };
  }

  const holderMatch = scope.match(SUBNET_HOLDER_REGEX);
  if (holderMatch) {
    return {
      type: 'subnet',
      netuid: parseInt(holderMatch[1]!, 10),
      role: 'holder',
      minAmount: optionalAmount(holderMatch[2]),
    };
  }

  const taoMatch = scope.match(TAO_SCOPE_REGEX);
  if (taoMatch) {
    return {
      type: 'tao',
      netuid: 0,
      role: 'holder',
      minAmount: optionalAmount(taoMatch[1]),
    };
  }

  const delegateMatch = scope.match(DELEGATE_SCOPE_REGEX);
  if (delegateMatch) {
    return {
      type: 'delegate',
      netuid: 0,
      role: 'delegate',
      hotkey: delegateMatch[1]!,
      minAmount: optionalAmount(delegateMatch[2]),
    };
  }

  const stakerMatch = scope.match(STAKER_SCOPE_REGEX);
  if (stakerMatch) {
    return {
      type: 'staker',
      netuid: 0,
      role: 'staker',
      minAmount: BigInt(stakerMatch[1]!) * RAO_PER_UNIT,
    };
  }

  throw new InvalidScopeFormatError(scope);
}

export function validateScopeFormat(scope: string): boolean {
  return METADATA_SCOPES.has(scope)
    || SUBNET_ROLE_REGEX.test(scope)
    || SUBNET_HOLDER_REGEX.test(scope)
    || TAO_SCOPE_REGEX.test(scope)
    || DELEGATE_SCOPE_REGEX.test(scope)
    || STAKER_SCOPE_REGEX.test(scope);
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
 */
export function describeScope(scope: string): string {
  if (METADATA_SCOPES.has(scope)) return scope;

  try {
    const p = parseScope(scope);

    if (p.type === 'subnet') {
      const role = roleDescriptions[p.role] || p.role;
      const suffix = p.minAmount !== undefined
        ? ` (min ${p.minAmount / RAO_PER_UNIT} alpha)`
        : '';
      return `${role} on Subnet ${p.netuid}${suffix}`;
    }

    if (p.type === 'tao') {
      const suffix = p.minAmount !== undefined
        ? ` (min ${p.minAmount / RAO_PER_UNIT} TAO)`
        : '';
      return `TAO Holder${suffix}`;
    }

    if (p.type === 'delegate' && p.hotkey) {
      const short = `${p.hotkey.slice(0, 8)}...${p.hotkey.slice(-6)}`;
      const suffix = p.minAmount !== undefined
        ? ` (min ${p.minAmount / RAO_PER_UNIT} TAO)`
        : '';
      return `Delegator to ${short}${suffix}`;
    }

    if (p.type === 'staker' && p.minAmount !== undefined) {
      return `Staker (min ${p.minAmount / RAO_PER_UNIT} TAO total)`;
    }

    return scope;
  } catch {
    return scope;
  }
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
 *
 * For parametric scopes (holder/tao/delegate with min amount), the base
 * scope without the amount in allowed_scopes permits any amount.
 * Staker scopes must be listed explicitly (no base form exists).
 */
export function enforceClientScopes(
  requestedScopes: string[],
  allowedScopes: string[],
): void {
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

    throw new AuthError(
      `Scope "${scope}" is not allowed for this client`,
      403,
      'Forbidden',
    );
  }
}

const handlerMap: Record<string, ScopeHandler> = {
  tao: taoHolderHandler,
  delegate: delegateHandler,
  staker: stakerHandler,
};

/**
 * Verify all scopes using a resolved signer context.
 * Throws ScopeError (403) if ANY scope fails.
 */
export async function verifyScopes(
  ctx: SignerContext,
  scopes: string[],
): Promise<void> {
  for (const scope of scopes) {
    if (METADATA_SCOPES.has(scope)) continue;

    const parsed = parseScope(scope);
    const params: ScopeParams = {
      netuid: parsed.netuid,
      minAmount: parsed.minAmount,
      hotkey: parsed.hotkey,
    };

    const handler = parsed.type === 'subnet'
      ? subnetHandlers[parsed.role]
      : handlerMap[parsed.type];

    if (!handler) throw new InvalidScopeFormatError(scope);
    const result = await handler.verify(ctx, params);
    if (!result) throw new ScopeError(scope);
  }
}
