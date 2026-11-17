import { ScopeHandler } from './types';
import { taostatsGet } from '../taostats/client';

interface AccountStakeEntry {
  balance_staked: string;
}

/**
 * Verify that a coldkey's total staked portfolio meets a TAO minimum.
 * Uses Taostats API for pre-aggregated totals across all subnets.
 *
 * Scope format: staker:{min_tao}
 */
export const stakerHandler: ScopeHandler = {
  async verify(ctx, params) {
    const minTao = params.minAmount ?? BigInt(1);

    let result;
    try {
      result = await taostatsGet<AccountStakeEntry>(`/v1/accounts/${encodeURIComponent(ctx.coldkey!)}`);
    } catch (err) {
      console.warn(`Staker scope check failed for ${ctx.coldkey}:`, err);
      return false;
    }

    if (result.data.length === 0) return false;

    const totalRao = BigInt(result.data[0]!.balance_staked);
    return totalRao >= minTao;
  },
};
