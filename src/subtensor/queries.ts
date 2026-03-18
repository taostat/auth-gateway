import { getSubtensorApi } from './client';
import { config } from '../config';
import { BoundedMap } from '../util/boundedMap';

const KEYS_CACHE_TTL_MS = 30000;
const keysCache = new BoundedMap<number, { keys: Map<number, string>; fetchedAt: number }>(
  64,
  (entry) => Date.now() - entry.fetchedAt > KEYS_CACHE_TTL_MS,
);

function withTimeout<T>(promise: Promise<T>, label: string, ms: number = config.subtensorQueryTimeout): Promise<T> {
  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Subtensor query timed out: ${label} (${ms}ms)`)), ms),
    ),
  ]);
}

/**
 * Get all registered hotkeys for a given netuid.
 * Returns Map<uid, hotkey_address>
 */
export async function getKeysForNetuid(netuid: number): Promise<Map<number, string>> {
  const api = await getSubtensorApi();
  const entries: any = await withTimeout(
    (api.query as any).subtensorModule.keys.entries(netuid),
    `keys.entries(${netuid})`,
  );
  const keys = new Map<number, string>();
  for (const [storageKey, value] of entries) {
    // storageKey.args = [netuid, uid]
    const uid = (storageKey.args as any)[1].toNumber();
    const hotkey = value.toString();
    keys.set(uid, hotkey);
  }
  return keys;
}

/**
 * Get the owner of a subnet.
 */
export async function getSubnetOwner(netuid: number): Promise<string> {
  const api = await getSubtensorApi();
  const result: any = await withTimeout(
    (api.query as any).subtensorModule.subnetOwner(netuid),
    `subnetOwner(${netuid})`,
  );
  return result.toString();
}

/**
 * Stake info entry returned by stakeInfoRuntimeApi.getStakeInfoForColdkey.
 */
export interface StakeInfo {
  hotkey: string;
  coldkey: string;
  netuid: number;
  stake: bigint;
}

/**
 * Get all stake info for a coldkey via the Subtensor runtime API.
 * Uses the plural getStakeInfoForColdkeys (Vec<AccountId32>) which
 * returns Vec<(AccountId32, Vec<StakeInfo>)>.
 */
export async function getStakeInfoForColdkey(address: string): Promise<StakeInfo[]> {
  const api = await getSubtensorApi();
  const result: any = await withTimeout(
    (api.call as any).stakeInfoRuntimeApi.getStakeInfoForColdkeys([address]),
    `getStakeInfoForColdkeys(${address})`,
  );
  const json = result.toJSON();
  if (!Array.isArray(json) || json.length === 0) return [];
  const [, entries] = json[0] as [string, any[]];
  if (!Array.isArray(entries)) return [];
  return entries.map((e: any) => ({
    hotkey: e.hotkey,
    coldkey: e.coldkey,
    netuid: typeof e.netuid === 'number' ? e.netuid : Number(e.netuid),
    stake: BigInt(e.stake?.toString() || '0'),
  }));
}

/**
 * Get the total alpha stake a coldkey holds on a specific subnet.
 * Returns the sum across all hotkeys in RAO.
 */
export async function getAlphaStakeOnSubnet(address: string, netuid: number): Promise<bigint> {
  const stakeEntries = await getStakeInfoForColdkey(address);
  let total = BigInt(0);
  for (const e of stakeEntries) {
    if (e.netuid === netuid) total += e.stake;
  }
  return total;
}

/**
 * Get the free TAO balance for an address (in RAO).
 */
export async function getTaoBalance(address: string): Promise<bigint> {
  const api = await getSubtensorApi();
  const result: any = await withTimeout((api.query as any).system.account(address), `system.account(${address})`);
  const data = result.data || result.toJSON()?.data;
  return BigInt(data?.free?.toString() || '0');
}

/**
 * Get both the current epoch number and seconds until the next epoch
 * boundary for a given netuid. Fetches header and tempo once, avoiding
 * duplicate RPC calls when both values are needed.
 */
export async function getEpochDetails(netuid: number): Promise<{
  secondsUntilNextEpoch: number | null;
  currentEpoch: number | null;
}> {
  try {
    const api = await getSubtensorApi();
    const [header, tempo] = await Promise.all([
      withTimeout(api.rpc.chain.getHeader(), 'chain.getHeader()'),
      withTimeout((api.query as any).subtensorModule.tempo(netuid), `tempo(${netuid})`),
    ]);
    const blockNumber = header.number.toNumber();
    const tempoVal = (tempo as any).toNumber();
    if (tempoVal === 0) return { secondsUntilNextEpoch: null, currentEpoch: null };

    const currentEpoch = Math.floor(blockNumber / tempoVal);
    const blocksUntilNextEpoch = tempoVal - (blockNumber % tempoVal);
    const secondsUntilNextEpoch = blocksUntilNextEpoch * config.subtensorBlockTime;

    return { secondsUntilNextEpoch, currentEpoch };
  } catch {
    return { secondsUntilNextEpoch: null, currentEpoch: null };
  }
}

/**
 * Get the current epoch (block-based tempo) for a given netuid.
 * Returns the current epoch number, or null if unavailable.
 */
export async function getCurrentEpoch(netuid: number): Promise<number | null> {
  const { currentEpoch } = await getEpochDetails(netuid);
  return currentEpoch;
}

/**
 * Get the number of seconds until the next epoch boundary for a given netuid.
 * Used to set access token expiry aligned to epoch boundaries.
 * Returns null if unavailable.
 */
export async function getSecondsUntilNextEpoch(netuid: number): Promise<number | null> {
  const { secondsUntilNextEpoch } = await getEpochDetails(netuid);
  return secondsUntilNextEpoch;
}

/**
 * Get the coldkey that owns a given hotkey.
 *
 * The codec type of subtensorModule.Owner depends on the runtime
 * version — it may be a ValueQuery (returns default zero AccountId
 * for missing keys) or an OptionQuery (returns None). We feature-
 * detect the codec shape rather than assuming either.
 *
 */
export async function getOwnerColdkey(hotkey: string): Promise<string | null> {
  const api = await getSubtensorApi();
  const result: any = await withTimeout((api.query as any).subtensorModule.owner(hotkey), `owner(${hotkey})`);

  let owner: string | null = null;

  if ('isNone' in result && result.isNone) {
    owner = null;
  } else if ('isSome' in result) {
    owner = result.unwrap().toString();
  } else if ('isEmpty' in result && result.isEmpty) {
    owner = null;
  } else if ('toU8a' in result) {
    const bytes = result.toU8a();
    const allZero = bytes.every((b: number) => b === 0);
    owner = allZero ? null : result.toString();
  } else {
    owner = result.toString();
  }

  return owner;
}

/**
 * Get dividends for a given netuid.
 * Returns a u16 array indexed by uid. Non-zero dividends indicate a validator.
 */
export async function getDividends(netuid: number): Promise<number[]> {
  const api = await getSubtensorApi();
  const result: any = await withTimeout((api.query as any).subtensorModule.dividends(netuid), `dividends(${netuid})`);
  return result.toJSON() as number[];
}

/**
 * Find the UID for a hotkey on a given netuid.
 * Returns undefined if the hotkey is not registered.
 */
export async function findUidByHotkey(netuid: number, hotkey: string): Promise<number | undefined> {
  const now = Date.now();
  let cached = keysCache.get(netuid);
  if (!cached || now - cached.fetchedAt > KEYS_CACHE_TTL_MS) {
    const keys = await getKeysForNetuid(netuid);
    cached = { keys, fetchedAt: now };
    keysCache.set(netuid, cached);
  }
  for (const [uid, registeredHotkey] of cached.keys) {
    if (registeredHotkey === hotkey) return uid;
  }
  return undefined;
}
