import { createMockApi, MockChainBuilder } from '../helpers/mockSubtensor';
import { SignerContext } from '../../scopes/signerContext';

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const BOB = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

const RAO = 1_000_000_000n;

const builder = new MockChainBuilder();
builder.setTaoBalance(ALICE, 250n * RAO); // 250 TAO
builder.setTaoBalance(BOB, 0n);
const mockApi = createMockApi(builder.getState());

jest.mock('../../subtensor/client', () => ({
  getSubtensorApi: jest.fn().mockResolvedValue(mockApi),
}));

import { taoHolderHandler } from '../../scopes/taoHolder';

function coldkey(address: string): SignerContext {
  return { sub: address, signerType: 'coldkey', hotkey: null, coldkey: address };
}

describe('TAO Holder Scope Handler', () => {
  test('address with TAO balance returns true', async () => {
    const result = await taoHolderHandler.verify(coldkey(ALICE), { netuid: 0 });
    expect(result).toBe(true);
  });

  test('address with zero TAO returns false', async () => {
    const result = await taoHolderHandler.verify(coldkey(BOB), { netuid: 0 });
    expect(result).toBe(false);
  });

  test('meets minimum TAO threshold', async () => {
    const result = await taoHolderHandler.verify(
      coldkey(ALICE),
      { netuid: 0, minAmount: 100n * RAO },
    );
    expect(result).toBe(true);
  });

  test('fails when below minimum TAO threshold', async () => {
    const result = await taoHolderHandler.verify(
      coldkey(ALICE),
      { netuid: 0, minAmount: 500n * RAO },
    );
    expect(result).toBe(false);
  });

  test('unknown address returns false', async () => {
    const result = await taoHolderHandler.verify(
      coldkey('5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy'),
      { netuid: 0 },
    );
    expect(result).toBe(false);
  });
});
