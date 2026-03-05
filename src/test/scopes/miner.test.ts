import { createMockApi, MockChainBuilder } from '../helpers/mockSubtensor';
import { SignerContext } from '../../scopes/signerContext';

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const BOB = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
const CHARLIE = '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y';

const builder = new MockChainBuilder();
builder.setMiner(ALICE, 1, 5);
builder.setValidator(BOB, 1, 3);
// CHARLIE: registered with zero dividends (miner even if would have permit)
builder.setMiner(CHARLIE, 1, 4);
const mockApi = createMockApi(builder.getState());

jest.mock('../../subtensor/client', () => ({
  getSubtensorApi: jest.fn().mockResolvedValue(mockApi),
}));

import { minerHandler } from '../../scopes/miner';

function hotkey(address: string): SignerContext {
  return { sub: address, signerType: 'hotkey', hotkey: address, coldkey: address };
}

describe('Miner Scope Handler', () => {
  test('address registered as miner returns true', async () => {
    const result = await minerHandler.verify(hotkey(ALICE), { netuid: 1 });
    expect(result).toBe(true);
  });

  test('address registered as validator returns false', async () => {
    const result = await minerHandler.verify(hotkey(BOB), { netuid: 1 });
    expect(result).toBe(false);
  });

  test('miner with validator permit still returns true', async () => {
    const result = await minerHandler.verify(hotkey(CHARLIE), { netuid: 1 });
    expect(result).toBe(true);
  });

  test('unregistered address returns false', async () => {
    const result = await minerHandler.verify(hotkey('5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy'), { netuid: 1 });
    expect(result).toBe(false);
  });

  test('address on different netuid returns false', async () => {
    const result = await minerHandler.verify(hotkey(ALICE), { netuid: 99 });
    expect(result).toBe(false);
  });

  test('coldkey signer (no hotkey) returns false', async () => {
    const ctx: SignerContext = { sub: ALICE, signerType: 'coldkey', hotkey: null, coldkey: ALICE };
    const result = await minerHandler.verify(ctx, { netuid: 1 });
    expect(result).toBe(false);
  });
});
