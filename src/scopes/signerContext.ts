import { getOwnerColdkey } from '../subtensor/queries';

export interface SignerContext {
  /** The address that signed the challenge (always present). */
  sub: string;
  /**
   * Whether the signer was identified as a hotkey, coldkey, or evm.
   *
   * Note: "coldkey" here means "not a registered hotkey". An unused
   * address will also be classified as coldkey. This is fine because
   * scope verification will fail for any role that requires
   * registration. The label indicates which key fields are populated,
   * not that the address is necessarily a real coldkey wallet.
   */
  signerType: 'hotkey' | 'coldkey' | 'evm';
  /** The hotkey address, or null if signer is not a registered hotkey. */
  hotkey: string | null;
  /**
   * The coldkey address. Always present for sr25519 signers:
   * - When signerType is "hotkey", this is the owning coldkey from chain.
   * - When signerType is "coldkey", this is the signing address itself.
   * Null for EVM signers.
   */
  coldkey: string | null;
  /** The EVM address (EIP-55 checksum), or null for sr25519 signers. */
  evmAddress: string | null;
}

/**
 * Resolve the signer context for an authenticated sr25519 address.
 *
 * Queries subtensorModule.Owner to determine whether the signing
 * address is a registered hotkey. If Owner returns a value, the
 * signer is a hotkey and we also have its coldkey. Otherwise we
 * treat the signing address as the coldkey.
 */
export async function resolveSignerContext(address: string): Promise<SignerContext> {
  const owner = await getOwnerColdkey(address);
  if (owner) {
    return { sub: address, signerType: 'hotkey', hotkey: address, coldkey: owner, evmAddress: null };
  }
  return { sub: address, signerType: 'coldkey', hotkey: null, coldkey: address, evmAddress: null };
}

/**
 * Resolve the signer context for an authenticated EVM address.
 * No on-chain lookup needed — EVM signers only use openid.
 */
export function resolveEvmSignerContext(address: string): SignerContext {
  return {
    sub: address,
    signerType: 'evm',
    hotkey: null,
    coldkey: null,
    evmAddress: address,
  };
}
