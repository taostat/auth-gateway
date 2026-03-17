import { signatureVerify } from '@polkadot/util-crypto';
import { verifyMessage } from 'viem';

import { InvalidSignatureError } from '../util/errors';
import { SignMethod } from './address';

export function verifySr25519Signature(
  message: string,
  signature: string,
  address: string,
): boolean {
  try {
    const trimmed = signature.trim();
    const normalizedSig = /^0x/i.test(trimmed) ? trimmed : `0x${trimmed}`;
    if (!/^0x[0-9a-fA-F]+$/.test(normalizedSig)) return false;
    const messageBytes = new TextEncoder().encode(message);
    const result = signatureVerify(messageBytes, normalizedSig, address);
    return result.isValid;
  } catch {
    return false;
  }
}

export async function verifyEvmSignature(
  message: string,
  signature: string,
  address: string,
): Promise<boolean> {
  try {
    const trimmed = signature.trim();
    const normalizedSig = /^0x/i.test(trimmed) ? trimmed : `0x${trimmed}`;
    if (!/^0x[0-9a-fA-F]+$/.test(normalizedSig)) return false;
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
