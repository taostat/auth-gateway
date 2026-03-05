import { Keyring } from '@polkadot/keyring';
import { u8aToHex } from '@polkadot/util';
import { cryptoWaitReady } from '@polkadot/util-crypto';

let alice: ReturnType<Keyring['addFromUri']> | null = null;

export async function getAliceKeypair() {
  await cryptoWaitReady();
  if (!alice) {
    const keyring = new Keyring({ type: 'sr25519' });
    alice = keyring.addFromUri('//Alice');
  }
  return alice;
}

export async function getAliceAddress(): Promise<string> {
  const keypair = await getAliceKeypair();
  return keypair.address;
}

export async function signWithAlice(message: string): Promise<string> {
  const keypair = await getAliceKeypair();
  const messageBytes = new TextEncoder().encode(message);
  const signature = keypair.sign(messageBytes);
  return u8aToHex(signature);
}
