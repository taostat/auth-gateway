import { signatureVerify } from '@polkadot/util-crypto';

import { InvalidSignatureError } from '../util/errors';

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

export function verifySignatureOrThrow(
  message: string,
  signature: string,
  address: string,
): void {
  if (!verifySr25519Signature(message, signature, address)) {
    throw new InvalidSignatureError();
  }
}
