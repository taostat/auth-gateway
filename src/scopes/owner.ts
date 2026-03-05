import { ScopeHandler } from './types';
import { getSubnetOwner } from '../subtensor/queries';

export const ownerHandler: ScopeHandler = {
  async verify(ctx, params) {
    try {
      const owner = await getSubnetOwner(params.netuid);
      return owner === ctx.coldkey!;
    } catch {
      return false;
    }
  },
};
