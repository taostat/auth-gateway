export interface MockChainState {
  keys: Map<number, Map<number, string>>;
  dividends: Map<number, number[]>;
  validatorPermits: Map<number, boolean[]>;
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
    validatorPermits: new Map(),
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

  private ensurePermitsSlot(netuid: number, uid: number): boolean[] {
    if (!this.state.validatorPermits.has(netuid)) this.state.validatorPermits.set(netuid, []);
    const permits = this.state.validatorPermits.get(netuid)!;
    while (permits.length <= uid) permits.push(false);
    return permits;
  }

  setMiner(address: string, netuid: number, uid: number, coldkey?: string): this {
    if (!this.state.keys.has(netuid)) this.state.keys.set(netuid, new Map());
    this.state.keys.get(netuid)!.set(uid, address);
    const divs = this.ensureDividendsSlot(netuid, uid);
    divs[uid] = 0;
    const permits = this.ensurePermitsSlot(netuid, uid);
    permits[uid] = false;
    this.state.hotkeyOwners.set(address, coldkey ?? address);
    return this;
  }

  setValidator(address: string, netuid: number, uid: number, coldkey?: string): this {
    if (!this.state.keys.has(netuid)) this.state.keys.set(netuid, new Map());
    this.state.keys.get(netuid)!.set(uid, address);
    const divs = this.ensureDividendsSlot(netuid, uid);
    divs[uid] = 65535;
    const permits = this.ensurePermitsSlot(netuid, uid);
    permits[uid] = true;
    this.state.hotkeyOwners.set(address, coldkey ?? address);
    return this;
  }

  setSubnetOwner(netuid: number, address: string): this {
    this.state.subnetOwners.set(netuid, address);
    return this;
  }

  setTaoBalance(address: string, balance: bigint): this {
    this.state.accounts.set(address, { free: balance });
    return this;
  }

  setAlphaBalance(coldkey: string, netuid: number, balance: bigint, hotkey?: string): this {
    this.state.alphaBalances.set(`${coldkey}:${netuid}`, balance);
    if (!this.state.stakeEntries) this.state.stakeEntries = [];
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
      system: {
        account: jest.fn().mockImplementation((address: string) => {
          const account = state.accounts.get(address) || { free: BigInt(0) };
          return Promise.resolve({
            data: { free: { toString: () => account.free.toString() } },
          });
        }),
      },
      subtensorModule: {
        uids: jest.fn().mockImplementation((netuid: number, hotkey: string) => {
          const keysMap = state.keys.get(netuid) || new Map();
          for (const [uid, registeredHotkey] of keysMap.entries()) {
            if (registeredHotkey === hotkey) {
              return Promise.resolve({
                isNone: false,
                isSome: true,
                unwrap: () => ({ toNumber: () => uid }),
                toNumber: () => uid,
              });
            }
          }
          return Promise.resolve({
            isNone: true,
            isSome: false,
            toNumber: () => 0,
          });
        }),
        dividends: jest.fn().mockImplementation((netuid: number) => {
          const divs = state.dividends.get(netuid) || [];
          return Promise.resolve({ toJSON: () => divs });
        }),
        validatorPermit: jest.fn().mockImplementation((netuid: number) => {
          const permits = state.validatorPermits.get(netuid) || [];
          return Promise.resolve({ toJSON: () => permits });
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
        getStakeInfoForColdkeys: jest.fn().mockImplementation((addresses: string[]) => {
          const result = addresses.map((address: string) => {
            const entries = (state.stakeEntries || []).filter((e: any) => e.coldkey === address);
            return [address, entries];
          });
          return Promise.resolve({ toJSON: () => result });
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
