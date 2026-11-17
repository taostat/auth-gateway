import { ScopeHandler } from './types';
import { taostatsGet } from '../taostats/client';

interface StakeBalanceEntry {
  balance_as_tao: string;
}

/**
 * Verify that a coldkey has staked to a specific hotkey (validator).
 * Uses Taostats API to aggregate across all subnets with TAO conversion.
 *
 * Scope format: delegate:{hotkey} or delegate:{hotkey}:{min_tao}
 */
export const delegateHandler: ScopeHandler = {
  async verify(ctx, params) {
    if (!params.hotkey) return false;

    let result;
    try {
      result = await taostatsGet<StakeBalanceEntry>('/v1/alpha/leaderboard', {
        coldkey: ctx.coldkey!,
        hotkey: params.hotkey,
        limit: '200',
      });
    } catch (err) {
      console.warn(`Delegate scope check failed for ${ctx.coldkey} -> ${params.hotkey}:`, err);
      return false;
    }

    if (result.data.length === 0) return false;

    const minTao = params.minAmount ?? BigInt(1);
    let totalRao = BigInt(0);
    for (const entry of result.data) {
      totalRao += BigInt(entry.balance_as_tao);
    }

    return totalRao >= minTao;
  },
};
