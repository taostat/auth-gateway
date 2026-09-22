import { signatureVerify } from '@polkadot/util-crypto';
import { verifyMessage } from 'viem';

import { InvalidSignatureError } from '../util/errors';
import { SignMethod } from './address';

/**
 * Accept a hex signature however it was pasted.
 *
 * btcli wraps its output, so a signature copied from a terminal arrives with
 * newlines and indentation inside it. Whitespace is never part of the value,
 * so all of it is stripped before the hex check.
 *
 * @returns The `0x`-prefixed signature, or null if it is not hex.
 */
export function normalizeSignature(signature: string): string | null {
  const stripped = signature.replace(/\s+/g, '');
  const prefixed = /^0x/i.test(stripped) ? stripped : `0x${stripped}`;
  return /^0x[0-9a-fA-F]+$/.test(prefixed) ? prefixed : null;
}

export function verifySr25519Signature(message: string, signature: string, address: string): boolean {
  try {
    const normalizedSig = normalizeSignature(signature);
    if (!normalizedSig) return false;
    const messageBytes = new TextEncoder().encode(message);
    const result = signatureVerify(messageBytes, normalizedSig, address);
    return result.isValid;
  } catch {
    return false;
  }
}

export async function verifyEvmSignature(message: string, signature: string, address: string): Promise<boolean> {
  try {
    const normalizedSig = normalizeSignature(signature);
    if (!normalizedSig) return false;
    return await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: normalizedSig as `0x${string}`,
    });
  } catch {
    return false;
  }
}

export async function verifySignature(
  message: string,
  signature: string,
  address: string,
  method: SignMethod,
): Promise<boolean> {
  if (method === 'evm') {
    return verifyEvmSignature(message, signature, address);
  }
  return verifySr25519Signature(message, signature, address);
}

export async function verifySignatureOrThrow(
  message: string,
  signature: string,
  address: string,
  method: SignMethod = 'sr25519',
): Promise<void> {
  const valid = await verifySignature(message, signature, address, method);
  if (!valid) {
    throw new InvalidSignatureError();
  }
}
