import { cryptoWaitReady } from '@polkadot/util-crypto';
import { getAliceAddress, signWithAlice } from '../helpers/sign';
import { verifySr25519Signature, verifySignatureOrThrow } from '../../crypto/signature';

beforeAll(async () => {
  await cryptoWaitReady();
});

describe('Signature Verification', () => {
  test('valid sr25519 signature is accepted', async () => {
    const message = 'bittensor-auth:none:test-nonce';
    const address = await getAliceAddress();
    const signature = await signWithAlice(message);

    expect(verifySr25519Signature(message, signature, address)).toBe(true);
  });

  test('invalid signature is rejected', async () => {
    const message = 'bittensor-auth:none:test-nonce';
    const address = await getAliceAddress();
    const badSig = '0x' + '00'.repeat(64);

    expect(verifySr25519Signature(message, badSig, address)).toBe(false);
  });

  test('signature for different message is rejected', async () => {
    const address = await getAliceAddress();
    const signature = await signWithAlice('original-message');

    expect(verifySr25519Signature('different-message', signature, address)).toBe(false);
  });

  test('valid signature with wrong address is rejected', async () => {
    const message = 'bittensor-auth:none:test-nonce';
    const signature = await signWithAlice(message);
    const wrongAddress = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'; // Bob

    expect(verifySr25519Signature(message, signature, wrongAddress)).toBe(false);
  });

  test('malformed signature string returns false', async () => {
    const message = 'test';
    const address = await getAliceAddress();

    expect(verifySr25519Signature(message, 'not-a-hex-signature', address)).toBe(false);
  });

  test('verifySignatureOrThrow throws InvalidSignatureError on invalid sig', async () => {
    const message = 'test';
    const address = await getAliceAddress();
    const badSig = '0x' + '00'.repeat(64);

    expect(() => verifySignatureOrThrow(message, badSig, address)).toThrow('Invalid signature');
  });

  test('verifySignatureOrThrow does not throw on valid sig', async () => {
    const message = 'bittensor-auth:none:test-nonce';
    const address = await getAliceAddress();
    const signature = await signWithAlice(message);

    expect(() => verifySignatureOrThrow(message, signature, address)).not.toThrow();
  });
});
