import { getSubtensorApi } from './client';
import { config } from '../config';
import { BoundedMap } from '../util/boundedMap';
import { subtensorQueryDurationSeconds } from '../metrics/registry';

async function withTimeout<T>(promise: Promise<T>, label: string, ms: number = config.subtensorQueryTimeout): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timer = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Subtensor query timed out: ${label} (${ms}ms)`)), ms);
  });
  const start = Date.now();
  try {
    const result = await Promise.race<T>([promise, timer]);
    subtensorQueryDurationSeconds.observe({ query: label, outcome: 'success' }, (Date.now() - start) / 1000);
    return result;
  } catch (err) {
    subtensorQueryDurationSeconds.observe({ query: label, outcome: 'failure' }, (Date.now() - start) / 1000);
    throw err;
  } finally {
    clearTimeout(timeoutId!);
  }
}

interface UidCacheEntry {
  uid: number | undefined;
  expiresAt: number;
}

const UID_CACHE_FALLBACK_TTL_MS = 60_000;
const uidCache = new BoundedMap<string, UidCacheEntry>(
  4096,
  (entry) => Date.now() >= entry.expiresAt,
);

function uidCacheKey(netuid: number, hotkey: string): string {
  return `${netuid}:${hotkey}`;
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
 * Returns a u16 array indexed by uid.
 */
export async function getDividends(netuid: number): Promise<number[]> {
  const api = await getSubtensorApi();
  const result: any = await withTimeout((api.query as any).subtensorModule.dividends(netuid), `dividends(${netuid})`);
  return result.toJSON() as number[];
}

/**
 * Get validator permits for a given netuid.
 * Returns a boolean array indexed by uid. True means the neuron has
 * enough stake to validate (granted by the chain, independent of
 * whether the validator has set weights or earned dividends).
 */
export async function getValidatorPermits(netuid: number): Promise<boolean[]> {
  const api = await getSubtensorApi();
  const result: any = await withTimeout(
    (api.query as any).subtensorModule.validatorPermit(netuid),
    `validatorPermit(${netuid})`,
  );
  return result.toJSON() as boolean[];
}

/**
 * Find the UID for a hotkey on a given netuid.
 * Returns undefined if the hotkey is not registered.
 *
 * Uses the on-chain `Uids` double-map (netuid, hotkey) -> uid, which
 * is an O(1) storage lookup. Results are cached per (netuid, hotkey)
 * until the next epoch boundary — registrations resolve at epoch
 * boundaries, so an entry is stable for the rest of the current epoch.
 */
export async function findUidByHotkey(netuid: number, hotkey: string): Promise<number | undefined> {
  const key = uidCacheKey(netuid, hotkey);
  const cached = uidCache.get(key);
  if (cached) return cached.uid;

  const api = await getSubtensorApi();
  const result: any = await withTimeout(
    (api.query as any).subtensorModule.uids(netuid, hotkey),
    `uids(${netuid}, ${hotkey})`,
  );

  let uid: number | undefined;
  if ('isNone' in result && result.isNone) uid = undefined;
  else if ('isSome' in result) uid = result.unwrap().toNumber();
  else if ('toNumber' in result) uid = result.toNumber();
  else uid = undefined;

  const secondsUntilNextEpoch = await getSecondsUntilNextEpoch(netuid);
  const ttlMs = secondsUntilNextEpoch !== null
    ? secondsUntilNextEpoch * 1000
    : UID_CACHE_FALLBACK_TTL_MS;
  uidCache.set(key, { uid, expiresAt: Date.now() + ttlMs });

  return uid;
}
