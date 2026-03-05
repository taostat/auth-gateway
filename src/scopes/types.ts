import { SignerContext } from './signerContext';

export interface ScopeHandler {
  verify(ctx: SignerContext, params: { netuid: number }): Promise<boolean>;
}
