import { isAddress, getAddress } from 'viem';
import { decodeAddress } from '@polkadot/util-crypto';

import { InvalidAddressError } from '../util/errors';

export type SignMethod = 'sr25519' | 'evm';

export const DEFAULT_SIGN_METHOD: SignMethod = 'sr25519';

export function detectSignMethod(address: string): SignMethod {
  if (/^0x[0-9a-fA-F]{40}$/i.test(address)) return 'evm';
  return 'sr25519';
}

export function isValidEvmAddress(address: string): boolean {
  return isAddress(address);
}

function isValidSS58(address: string): boolean {
  try {
    decodeAddress(address);
    return true;
  } catch {
    return false;
  }
}

export function normalizeEvmAddress(address: string): string {
  return getAddress(address);
}

export function isValidAddress(
  address: string,
  method: SignMethod,
): boolean {
  if (method === 'evm') return isValidEvmAddress(address);
  return isValidSS58(address);
}

/**
 * Detect, validate, and normalize an address in one step.
 * Throws InvalidAddressError if the address is malformed.
 */
export function validateAndNormalizeAddress(
  rawAddress: string,
): { address: string; method: SignMethod } {
  const method = detectSignMethod(rawAddress);
  if (!isValidAddress(rawAddress, method)) {
    const msg = method === 'evm'
      ? 'Invalid EVM address'
      : 'Invalid SS58 address';
    throw new InvalidAddressError(msg);
  }
  const address = method === 'evm'
    ? normalizeEvmAddress(rawAddress)
    : rawAddress;
  return { address, method };
}

/**
 * Extract the sign method from a client's allowed_sign_methods array.
 */
export function getClientSignMethod(
  methods: string[] | undefined | null,
): SignMethod {
  return (methods?.[0] as SignMethod) || DEFAULT_SIGN_METHOD;
}
