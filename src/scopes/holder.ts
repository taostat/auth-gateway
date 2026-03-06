import { ScopeHandler } from './types';
import { getAlphaStakeOnSubnet } from '../subtensor/queries';
import { taostatsGet } from '../taostats/client';

interface AlphaBalanceEntry {
  balance: string;
}

export const holderHandler: ScopeHandler = {
  async verify(ctx, params) {
    const minAmount = params.minAmount ?? BigInt(1);
    try {
      const stake = await getAlphaStakeOnSubnet(ctx.coldkey, params.netuid);
      if (stake >= minAmount) return true;
    } catch (err) {
      console.warn(
        `On-chain holder check failed for ${ctx.coldkey} on subnet ${params.netuid}:`,
        err,
      );
    }
    return await checkBalanceViaTaostatsApi(
      ctx.coldkey,
      params.netuid,
      minAmount,
    );
  },
};

async function checkBalanceViaTaostatsApi(
  address: string,
  netuid: number,
  minAmount: bigint,
): Promise<boolean> {
  try {
    const result = await taostatsGet<AlphaBalanceEntry>(
      `/api/dtao/stake_balance/latest/v1`,
      { coldkey: address, netuid: String(netuid), limit: '100' },
    );
    let total = BigInt(0);
    for (const entry of result.data) {
      total += BigInt(entry.balance || '0');
    }
    return total >= minAmount;
  } catch {
    return false;
  }
}
