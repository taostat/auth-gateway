import { SignerContext } from './signerContext';

/**
 * Which Bittensor key a scope is verified against.
 *
 * - `hotkey`: only a registered hotkey satisfies it (the verifier reads `ctx.hotkey`).
 * - `coldkey`: verified against the coldkey. A hotkey signature also works, since
 *   the signer context resolves a hotkey to its owning coldkey on chain.
 * - `any`: no on-chain check, so either key works.
 */
export type SigningKey = 'hotkey' | 'coldkey' | 'any';

export interface ParsedScope {
  type: 'subnet' | 'tao' | 'delegate' | 'staker' | 'metadata';
  role: string;
  netuid: number;
  minAmount?: bigint | undefined;
  hotkey?: string | undefined;
}

export interface ScopeHandler {
  verify(ctx: SignerContext, params: ParsedScope): Promise<boolean>;
}
