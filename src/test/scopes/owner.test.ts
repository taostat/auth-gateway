import { createMockApi, MockChainBuilder } from '../helpers/mockSubtensor';
import { SignerContext } from '../../scopes/signerContext';

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const BOB = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

const builder = new MockChainBuilder();
builder.setSubnetOwner(1, ALICE);
const mockApi = createMockApi(builder.getState());

jest.mock('../../subtensor/client', () => ({
  getSubtensorApi: jest.fn().mockResolvedValue(mockApi),
}));

import { ownerHandler } from '../../scopes/owner';

function coldkey(address: string): SignerContext {
  return { sub: address, signerType: 'coldkey', hotkey: null, coldkey: address };
}

describe('Owner Scope Handler', () => {
  test('address matches subnet owner returns true', async () => {
    const result = await ownerHandler.verify(coldkey(ALICE), { netuid: 1 });
    expect(result).toBe(true);
  });

  test('different address returns false', async () => {
    const result = await ownerHandler.verify(coldkey(BOB), { netuid: 1 });
    expect(result).toBe(false);
  });

  test('nonexistent subnet returns false', async () => {
    const result = await ownerHandler.verify(coldkey(ALICE), { netuid: 999 });
    expect(result).toBe(false);
  });
});
