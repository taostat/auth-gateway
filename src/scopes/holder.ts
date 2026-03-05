import { ScopeHandler } from './types';
import { hasAlphaOnSubnet } from '../subtensor/queries';
import { config } from '../config';

export const holderHandler: ScopeHandler = {
  async verify(ctx, params) {
    try {
      return await hasAlphaOnSubnet(ctx.coldkey, params.netuid);
    } catch (err) {
      console.error(`On-chain holder check failed for ${ctx.coldkey} on subnet ${params.netuid}:`, err);
      return await checkBalanceViaTaostatsApi(ctx.coldkey, params.netuid);
    }
  },
};

async function checkBalanceViaTaostatsApi(address: string, netuid: number): Promise<boolean> {
  try {
    const url = `${config.taostatsApiUrl}/api/subnets/${netuid}/alpha/${address}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { balance?: string };
    const balance = BigInt(data.balance || '0');
    return balance > BigInt(0);
  } catch {
    return false;
  }
}
