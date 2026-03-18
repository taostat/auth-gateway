import { SignerContext } from '../../scopes/signerContext';

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const VALIDATOR = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

const RAO = 1_000_000_000n;

const mockTaostatsGet = jest.fn();

jest.mock('../../taostats/client', () => ({
  ...jest.requireActual('../../taostats/client'),
  taostatsGet: (...args: unknown[]) => mockTaostatsGet(...args),
}));

import { delegateHandler } from '../../scopes/delegate';

function coldkey(address: string): SignerContext {
  return { sub: address, signerType: 'coldkey', hotkey: null, coldkey: address };
}

describe('Delegate Scope Handler', () => {
  beforeEach(() => {
    mockTaostatsGet.mockReset();
  });

  test('returns true when staked to hotkey', async () => {
    mockTaostatsGet.mockResolvedValue({
      data: [{ balance_as_tao: '150500000000' }],
      pagination: { total_items: 1 },
    });
    const result = await delegateHandler.verify(coldkey(ALICE), { netuid: 0, hotkey: VALIDATOR });
    expect(result).toBe(true);
    expect(mockTaostatsGet).toHaveBeenCalledWith(
      '/api/dtao/stake_balance/latest/v1',
      expect.objectContaining({ coldkey: ALICE, hotkey: VALIDATOR }),
    );
  });

  test('returns false when not staked', async () => {
    mockTaostatsGet.mockResolvedValue({ data: [], pagination: { total_items: 0 } });
    const result = await delegateHandler.verify(coldkey(ALICE), { netuid: 0, hotkey: VALIDATOR });
    expect(result).toBe(false);
  });

  test('returns false when no hotkey in params', async () => {
    const result = await delegateHandler.verify(coldkey(ALICE), { netuid: 0 });
    expect(result).toBe(false);
    expect(mockTaostatsGet).not.toHaveBeenCalled();
  });

  test('aggregates across subnets for minimum', async () => {
    mockTaostatsGet.mockResolvedValue({
      data: [{ balance_as_tao: '80000000000' }, { balance_as_tao: '120000000000' }],
      pagination: { total_items: 2 },
    });
    const result = await delegateHandler.verify(coldkey(ALICE), {
      netuid: 0,
      hotkey: VALIDATOR,
      minAmount: 150n * RAO,
    });
    expect(result).toBe(true);
  });

  test('fails when below minimum across subnets', async () => {
    mockTaostatsGet.mockResolvedValue({
      data: [{ balance_as_tao: '50000000000' }],
      pagination: { total_items: 1 },
    });
    const result = await delegateHandler.verify(coldkey(ALICE), {
      netuid: 0,
      hotkey: VALIDATOR,
      minAmount: 100n * RAO,
    });
    expect(result).toBe(false);
  });

  test('returns false when Taostats API call fails', async () => {
    mockTaostatsGet.mockRejectedValue(new Error('Taostats unavailable'));
    const result = await delegateHandler.verify(coldkey(ALICE), { netuid: 0, hotkey: VALIDATOR, minAmount: 1n * RAO });
    expect(result).toBe(false);
  });
});
