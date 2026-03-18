import { verifyEvmSignature, verifySignature } from '../../crypto/signature';
import { getTestEvmAddress, signWithTestEvmWallet } from '../helpers/evmSign';

describe('EVM Signature Verification', () => {
  test('valid EVM signature is accepted', async () => {
    const message = 'taostats-auth:none:test-nonce';
    const address = getTestEvmAddress();
    const signature = await signWithTestEvmWallet(message);

    const valid = await verifyEvmSignature(message, signature, address);
    expect(valid).toBe(true);
  });

  test('invalid signature is rejected', async () => {
    const message = 'taostats-auth:none:test-nonce';
    const address = getTestEvmAddress();
    const badSig = '0x' + '00'.repeat(65);

    const valid = await verifyEvmSignature(message, badSig, address);
    expect(valid).toBe(false);
  });

  test('signature for different message is rejected', async () => {
    const address = getTestEvmAddress();
    const signature = await signWithTestEvmWallet('original-message');

    const valid = await verifyEvmSignature('different-message', signature, address);
    expect(valid).toBe(false);
  });

  test('valid signature with wrong address is rejected', async () => {
    const message = 'taostats-auth:none:test-nonce';
    const signature = await signWithTestEvmWallet(message);
    const wrongAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

    const valid = await verifyEvmSignature(message, signature, wrongAddress);
    expect(valid).toBe(false);
  });

  test('malformed signature returns false', async () => {
    const address = getTestEvmAddress();
    const valid = await verifyEvmSignature('test', 'not-a-sig', address);
    expect(valid).toBe(false);
  });

  test('verifySignature dispatches to EVM', async () => {
    const message = 'test-dispatch';
    const address = getTestEvmAddress();
    const signature = await signWithTestEvmWallet(message);

    const valid = await verifySignature(message, signature, address, 'evm');
    expect(valid).toBe(true);
  });
});
