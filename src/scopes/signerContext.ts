import { getOwnerColdkey } from '../subtensor/queries';

export interface SignerContext {
  /** The address that signed the challenge (always present). */
  sub: string;
  /**
   * Whether the signer was identified as a hotkey or coldkey.
   *
   * Note: "coldkey" here means "not a registered hotkey". An unused
   * address will also be classified as coldkey. This is fine because
   * scope verification will fail for any role that requires
   * registration. The label indicates which key fields are populated,
   * not that the address is necessarily a real coldkey wallet.
   */
  signerType: 'hotkey' | 'coldkey';
  /** The hotkey address, or null if signer is not a registered hotkey. */
  hotkey: string | null;
  /**
   * The coldkey address. Always present:
   * - When signerType is "hotkey", this is the owning coldkey from chain.
   * - When signerType is "coldkey", this is the signing address itself.
   */
  coldkey: string;
}

/**
 * Resolve the signer context for an authenticated address.
 *
 * Queries subtensorModule.Owner to determine whether the signing
 * address is a registered hotkey. If Owner returns a value, the
 * signer is a hotkey and we also have its coldkey. Otherwise we
 * treat the signing address as the coldkey.
 */
export async function resolveSignerContext(address: string): Promise<SignerContext> {
  const owner = await getOwnerColdkey(address);
  if (owner) {
    return { sub: address, signerType: 'hotkey', hotkey: address, coldkey: owner };
  }
  return { sub: address, signerType: 'coldkey', hotkey: null, coldkey: address };
}
