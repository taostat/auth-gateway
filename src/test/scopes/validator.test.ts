import { createMockApi, MockChainBuilder } from '../helpers/mockSubtensor';
import { SignerContext } from '../../scopes/signerContext';

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const BOB = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

const builder = new MockChainBuilder();
builder.setValidator(ALICE, 1, 3);
builder.setMiner(BOB, 1, 5);
const mockApi = createMockApi(builder.getState());

jest.mock('../../subtensor/client', () => ({
  getSubtensorApi: jest.fn().mockResolvedValue(mockApi),
}));

import { validatorHandler } from '../../scopes/validator';

function hotkey(address: string): SignerContext {
  return { sub: address, signerType: 'hotkey', hotkey: address, coldkey: address };
}

describe('Validator Scope Handler', () => {
  test('address with validator permit returns true', async () => {
    const result = await validatorHandler.verify(hotkey(ALICE), { netuid: 1 });
    expect(result).toBe(true);
  });

  test('address without validator permit (miner) returns false', async () => {
    const result = await validatorHandler.verify(hotkey(BOB), { netuid: 1 });
    expect(result).toBe(false);
  });

  test('unregistered address returns false', async () => {
    const result = await validatorHandler.verify(hotkey('5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy'), { netuid: 1 });
    expect(result).toBe(false);
  });

  test('coldkey signer (no hotkey) returns false', async () => {
    const ctx: SignerContext = { sub: ALICE, signerType: 'coldkey', hotkey: null, coldkey: ALICE };
    const result = await validatorHandler.verify(ctx, { netuid: 1 });
    expect(result).toBe(false);
  });
});
