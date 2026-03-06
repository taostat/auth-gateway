import { SignerContext } from '../../scopes/signerContext';

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

const RAO = 1_000_000_000n;

const mockTaostatsGet = jest.fn();

jest.mock('../../taostats/client', () => ({
  ...jest.requireActual('../../taostats/client'),
  taostatsGet: (...args: unknown[]) => mockTaostatsGet(...args),
}));

import { stakerHandler } from '../../scopes/staker';

function coldkey(address: string): SignerContext {
  return { sub: address, signerType: 'coldkey', hotkey: null, coldkey: address };
}

describe('Staker Scope Handler', () => {
  beforeEach(() => {
    mockTaostatsGet.mockReset();
  });

  test('returns true when total exceeds minimum', async () => {
    mockTaostatsGet.mockResolvedValue({
      data: [{ total_balance_as_tao: '5000.0' }],
      pagination: { total_items: 1 },
    });
    const result = await stakerHandler.verify(
      coldkey(ALICE),
      { netuid: 0, minAmount: 1000n * RAO },
    );
    expect(result).toBe(true);
  });

  test('returns false when below minimum', async () => {
    mockTaostatsGet.mockResolvedValue({
      data: [{ total_balance_as_tao: '500.0' }],
      pagination: { total_items: 1 },
    });
    const result = await stakerHandler.verify(
      coldkey(ALICE),
      { netuid: 0, minAmount: 1000n * RAO },
    );
    expect(result).toBe(false);
  });

  test('returns false when no data', async () => {
    mockTaostatsGet.mockResolvedValue({ data: [], pagination: { total_items: 0 } });
    const result = await stakerHandler.verify(
      coldkey(ALICE),
      { netuid: 0, minAmount: 100n * RAO },
    );
    expect(result).toBe(false);
  });

  test('handles precise decimal conversion to RAO', async () => {
    mockTaostatsGet.mockResolvedValue({
      data: [{ total_balance_as_tao: '0.000000001' }],
      pagination: { total_items: 1 },
    });
    const result = await stakerHandler.verify(
      coldkey(ALICE),
      { netuid: 0, minAmount: 1n },
    );
    expect(result).toBe(true);
  });

  test('returns false when Taostats API call fails', async () => {
    mockTaostatsGet.mockRejectedValue(new Error('Taostats unavailable'));
    const result = await stakerHandler.verify(
      coldkey(ALICE),
      { netuid: 0, minAmount: 100n * RAO },
    );
    expect(result).toBe(false);
  });
});
