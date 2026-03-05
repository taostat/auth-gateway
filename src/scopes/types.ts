import { SignerContext } from './signerContext';

export interface ParsedScope {
  type: 'subnet' | 'tao' | 'delegate' | 'staker';
  role: string;
  netuid: number;
  minAmount?: bigint | undefined;
  hotkey?: string | undefined;
}

export interface ScopeHandler {
  verify(ctx: SignerContext, params: ParsedScope): Promise<boolean>;
}
