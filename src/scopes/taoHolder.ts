import { ScopeHandler } from './types';
import { getTaoBalance } from '../subtensor/queries';

export const taoHolderHandler: ScopeHandler = {
  async verify(ctx, params) {
    const minAmount = params.minAmount ?? BigInt(1);
    const balance = await getTaoBalance(ctx.coldkey);
    return balance >= minAmount;
  },
};
