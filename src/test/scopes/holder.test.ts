import { createMockApi, MockChainBuilder } from '../helpers/mockSubtensor';
import { SignerContext } from '../../scopes/signerContext';

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const BOB = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

const builder = new MockChainBuilder();
builder.setAlphaBalance(ALICE, 1, 500_000_000_000n); // 500 alpha
builder.setAlphaBalance(BOB, 1, 0n);
const mockApi = createMockApi(builder.getState());

jest.mock('../../subtensor/client', () => ({
  getSubtensorApi: jest.fn().mockResolvedValue(mockApi),
}));

import { holderHandler } from '../../scopes/holder';

function coldkey(address: string): SignerContext {
  return { sub: address, signerType: 'coldkey', hotkey: null, coldkey: address };
}

const RAO = 1_000_000_000n;
const mockTaostatsGet = jest.fn();

jest.mock('../../taostats/client', () => ({
  ...jest.requireActual('../../taostats/client'),
  taostatsGet: (...args: unknown[]) => mockTaostatsGet(...args),
}));

describe('Holder Scope Handler', () => {
  beforeEach(() => {
    mockTaostatsGet.mockReset();
  });

  test('address with alpha balance > 0 returns true', async () => {
    const result = await holderHandler.verify(coldkey(ALICE), { netuid: 1 });
    expect(result).toBe(true);
  });

  test('address with zero alpha balance returns false', async () => {
    const result = await holderHandler.verify(coldkey(BOB), { netuid: 1 });
    expect(result).toBe(false);
  });

  test('address with no alpha entry returns false', async () => {
    const result = await holderHandler.verify(coldkey('5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy'), {
      netuid: 1,
    });
    expect(result).toBe(false);
  });

  test('meets minimum amount threshold', async () => {
    const result = await holderHandler.verify(coldkey(ALICE), { netuid: 1, minAmount: 100n * RAO });
    expect(result).toBe(true);
  });

  test('fails when below minimum amount threshold', async () => {
    const result = await holderHandler.verify(coldkey(ALICE), { netuid: 1, minAmount: 1000n * RAO });
    expect(result).toBe(false);
  });

  test('exact minimum amount passes', async () => {
    const result = await holderHandler.verify(coldkey(ALICE), { netuid: 1, minAmount: 500n * RAO });
    expect(result).toBe(true);
  });

  test('uses the alpha leaderboard when the on-chain read is below the minimum', async () => {
    mockTaostatsGet.mockResolvedValue({ data: [{ balance: '1000000000000' }] });

    const result = await holderHandler.verify(coldkey(BOB), { netuid: 1, minAmount: 100n * RAO });

    expect(result).toBe(true);
    expect(mockTaostatsGet).toHaveBeenCalledWith('/v1/alpha/leaderboard', {
      coldkey: BOB,
      netuid: '1',
      limit: '200',
    });
  });
});
