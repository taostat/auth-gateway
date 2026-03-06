import { SignerContext } from './signerContext';

export interface ScopeParams {
  netuid: number;
  minAmount?: bigint | undefined;
  hotkey?: string | undefined;
}

export interface ScopeHandler {
  verify(ctx: SignerContext, params: ScopeParams): Promise<boolean>;
}
