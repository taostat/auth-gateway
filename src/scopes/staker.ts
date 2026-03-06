import { ScopeHandler } from './types';
import { taostatsGet, taoStringToRao } from '../taostats/client';

interface AggregatedStakeEntry {
  total_balance_as_tao: string;
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
      result = await taostatsGet<AggregatedStakeEntry>(
        '/api/dtao/stake_balance_aggregated/latest/v1',
        { coldkey: ctx.coldkey, limit: '1' },
      );
    } catch (err) {
      console.warn(`Staker scope check failed for ${ctx.coldkey}:`, err);
      return false;
    }

    if (result.data.length === 0) return false;

    const totalRao = taoStringToRao(result.data[0]!.total_balance_as_tao);
    return totalRao >= minTao;
  },
};
