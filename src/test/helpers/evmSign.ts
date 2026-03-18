import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

// Hardhat #0 test private key (well-known, never use in production)
const TEST_EVM_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

const account = privateKeyToAccount(TEST_EVM_PRIVATE_KEY);

export function getTestEvmAddress(): string {
  return account.address;
}

export async function signWithTestEvmWallet(message: string): Promise<string> {
  const client = createWalletClient({
    account,
    chain: mainnet,
    transport: http(),
  });
  return client.signMessage({ message });
}
