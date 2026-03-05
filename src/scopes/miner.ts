import { ScopeHandler } from './types';
import { findUidByHotkey, getDividends } from '../subtensor/queries';

export const minerHandler: ScopeHandler = {
  async verify(ctx, params) {
    if (!ctx.hotkey) return false;

    const [uid, dividends] = await Promise.all([
      findUidByHotkey(params.netuid, ctx.hotkey),
      getDividends(params.netuid),
    ]);
    if (uid === undefined) return false;

    // Miner: registered with zero dividends (validators earn dividends)
    if (uid >= dividends.length) return true;
    return dividends[uid] === 0;
  },
};
