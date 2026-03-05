export interface MockChainState {
  keys: Map<number, Map<number, string>>;
  dividends: Map<number, number[]>;
  subnetOwners: Map<number, string>;
  hotkeyOwners: Map<string, string>;
  accounts: Map<string, { free: bigint }>;
  alphaBalances: Map<string, bigint>;
  stakeEntries: any[];
}

export function createMockChainState(): MockChainState {
  return {
    keys: new Map(),
    dividends: new Map(),
    subnetOwners: new Map(),
    hotkeyOwners: new Map(),
    accounts: new Map(),
    alphaBalances: new Map(),
    stakeEntries: [],
  };
}

export class MockChainBuilder {
  private state: MockChainState;

  constructor(state?: MockChainState) {
    this.state = state || createMockChainState();
  }

  setHotkeyOwner(hotkey: string, coldkey: string): this {
    this.state.hotkeyOwners.set(hotkey, coldkey);
    return this;
  }

  private ensureDividendsSlot(netuid: number, uid: number): number[] {
    if (!this.state.dividends.has(netuid)) this.state.dividends.set(netuid, []);
    const divs = this.state.dividends.get(netuid)!;
    while (divs.length <= uid) divs.push(0);
    return divs;
  }

  setMiner(address: string, netuid: number, uid: number, coldkey?: string): this {
    if (!this.state.keys.has(netuid)) this.state.keys.set(netuid, new Map());
    this.state.keys.get(netuid)!.set(uid, address);
    const divs = this.ensureDividendsSlot(netuid, uid);
    divs[uid] = 0;
    this.state.hotkeyOwners.set(address, coldkey ?? address);
    return this;
  }

  setValidator(address: string, netuid: number, uid: number, coldkey?: string): this {
    if (!this.state.keys.has(netuid)) this.state.keys.set(netuid, new Map());
    this.state.keys.get(netuid)!.set(uid, address);
    const divs = this.ensureDividendsSlot(netuid, uid);
    divs[uid] = 65535;
    this.state.hotkeyOwners.set(address, coldkey ?? address);
    return this;
  }

  setSubnetOwner(netuid: number, address: string): this {
    this.state.subnetOwners.set(netuid, address);
    return this;
  }

  setAlphaBalance(coldkey: string, netuid: number, balance: bigint, hotkey?: string): this {
    this.state.alphaBalances.set(`${coldkey}:${netuid}`, balance);
    // Store stake info for runtime API mock
    const key = `${coldkey}:${netuid}`;
    if (!this.state.stakeEntries) this.state.stakeEntries = [];
    // Remove existing entry for this coldkey+netuid
    this.state.stakeEntries = this.state.stakeEntries.filter(
      (e: any) => !(e.coldkey === coldkey && e.netuid === netuid),
    );
    this.state.stakeEntries.push({
      hotkey: hotkey || coldkey,
      coldkey,
      netuid,
      stake: balance.toString(),
    });
    return this;
  }

  getState(): MockChainState {
    return this.state;
  }
}

export function createMockApi(state: MockChainState) {
  return {
    isConnected: true,
    on: jest.fn(),
    disconnect: jest.fn().mockResolvedValue(undefined),
    query: {
      subtensorModule: {
        keys: {
          entries: jest.fn().mockImplementation((netuid: number) => {
            const keysMap = state.keys.get(netuid) || new Map();
            return Promise.resolve(
              Array.from(keysMap.entries()).map(([uid, hotkey]) => [
                { args: [{ toNumber: () => netuid }, { toNumber: () => uid }] },
                { toString: () => hotkey },
              ]),
            );
          }),
        },
        dividends: jest.fn().mockImplementation((netuid: number) => {
          const divs = state.dividends.get(netuid) || [];
          return Promise.resolve({ toJSON: () => divs });
        }),
        subnetOwner: jest.fn().mockImplementation((netuid: number) => {
          const owner = state.subnetOwners.get(netuid) || '';
          return Promise.resolve({ toString: () => owner });
        }),
        alpha: jest.fn().mockImplementation((address: string, netuid: number) => {
          const balance = state.alphaBalances.get(`${address}:${netuid}`) || BigInt(0);
          return Promise.resolve({ toString: () => balance.toString() });
        }),
        owner: jest.fn().mockImplementation((hotkey: string) => {
          const coldkey = state.hotkeyOwners.get(hotkey);
          if (coldkey) {
            return Promise.resolve({
              isNone: false,
              isSome: true,
              unwrap: () => ({ toString: () => coldkey }),
              toString: () => coldkey,
            });
          }
          return Promise.resolve({
            isNone: true,
            isSome: false,
            isEmpty: true,
            toString: () => '',
          });
        }),
        tempo: jest.fn().mockImplementation((_netuid: number) => {
          return Promise.resolve({ toNumber: () => 360 }); // 360 blocks per epoch
        }),
      },
    },
    call: {
      stakeInfoRuntimeApi: {
        getStakeInfoForColdkey: jest.fn().mockImplementation((address: string) => {
          const entries = (state.stakeEntries || []).filter((e: any) => e.coldkey === address);
          return Promise.resolve({ toJSON: () => entries });
        }),
      },
    },
    rpc: {
      chain: {
        getHeader: jest.fn().mockResolvedValue({
          number: { toNumber: () => 1000 },
        }),
      },
    },
  } as any;
}

/**
 * Setup mock for the subtensor client module.
 * Call this in beforeAll or beforeEach with a mock chain state.
 */
export function setupMockSubtensor(state: MockChainState): void {
  const mockApi = createMockApi(state);
  jest.mock('../../subtensor/client', () => ({
    getSubtensorApi: jest.fn().mockResolvedValue(mockApi),
    disconnectSubtensor: jest.fn().mockResolvedValue(undefined),
    isSubtensorConnected: jest.fn().mockReturnValue(true),
  }));
}
