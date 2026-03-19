import { ScopeHandler } from './types';
import { findUidByHotkey, getValidatorPermits } from '../subtensor/queries';

export const validatorHandler: ScopeHandler = {
  async verify(ctx, params) {
    if (!ctx.hotkey) return false;

    const [uid, permits] = await Promise.all([
      findUidByHotkey(params.netuid, ctx.hotkey),
      getValidatorPermits(params.netuid),
    ]);
    if (uid === undefined) return false;

    // Validator: registered with a validator permit (stake-based)
    if (uid >= permits.length) return false;
    return permits[uid] === true;
  },
};
