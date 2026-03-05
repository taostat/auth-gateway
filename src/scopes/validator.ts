import { ScopeHandler } from './types';
import { findUidByHotkey, getDividends } from '../subtensor/queries';

export const validatorHandler: ScopeHandler = {
  async verify(ctx, params) {
    if (!ctx.hotkey) return false;

    const [uid, dividends] = await Promise.all([
      findUidByHotkey(params.netuid, ctx.hotkey),
      getDividends(params.netuid),
    ]);
    if (uid === undefined) return false;

    // Validator: registered with non-zero dividends
    if (uid >= dividends.length) return false;
    return dividends[uid] > 0;
  },
};
