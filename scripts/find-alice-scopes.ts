/**
 * Query the Subtensor testnet to find what roles/holdings Alice has.
 */
import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady } from '@polkadot/util-crypto';

const WS_URL = process.env.SUBTENSOR_WS_URL || 'wss://test.finney.opentensor.ai:443';

async function main() {
  await cryptoWaitReady();
  const keyring = new Keyring({ type: 'sr25519', ss58Format: 42 });
  const alice = keyring.addFromUri('//Alice');
  const aliceAddress = alice.address;

  console.log(`Alice: ${aliceAddress}`);
  console.log(`Connecting to ${WS_URL}...\n`);

  const provider = new WsProvider(WS_URL);
  const api = await ApiPromise.create({ provider, noInitWarn: true });

  // Check TAO balance
  const account = await api.query.system.account(aliceAddress);
  const free = (account as any).data.free.toBigInt();
  console.log(`TAO balance: ${free} (${Number(free) / 1e9} TAO)\n`);

  // Find total subnets
  const totalSubnets = await api.query.subtensorModule.totalNetworks();
  const total = Number(totalSubnets.toString());
  console.log(`Total subnets: ${total}\n`);

  // Check each subnet for Alice's registrations
  console.log('Scanning subnets for Alice...\n');

  for (let netuid = 0; netuid < total; netuid++) {
    try {
      // Check if Alice is registered (hotkey -> uid)
      const keys = await api.query.subtensorModule.keys.entries(netuid);
      let foundUid: number | null = null;

      for (const [key, value] of keys) {
        const hotkey = value.toString();
        if (hotkey === aliceAddress) {
          const uid = (key.args[1] as any).toNumber();
          foundUid = uid;
          break;
        }
      }

      // Check if Alice is subnet owner
      const owner = await api.query.subtensorModule.subnetOwner(netuid);
      const isOwner = owner.toString() === aliceAddress;

      // Check alpha balance
      let alphaBalance = 0n;
      try {
        // Try different storage names for alpha balance
        if ((api.query.subtensorModule as any).alphaBalance) {
          const bal = await (api.query.subtensorModule as any).alphaBalance(aliceAddress, netuid);
          alphaBalance = bal.toBigInt();
        }
      } catch {}

      if (foundUid !== null || isOwner || alphaBalance > 0n) {
        console.log(`--- Subnet ${netuid} ---`);

        if (isOwner) {
          console.log(`  OWNER: yes → scope: subnet:${netuid}:owner`);
        }

        if (foundUid !== null) {
          const divs = await (api.query as any).subtensorModule.dividends(netuid);
          const divsArray = (divs as any).toJSON() as number[];
          const hasDividends = foundUid < divsArray.length && divsArray[foundUid] > 0;

          if (hasDividends) {
            console.log(`  VALIDATOR: uid=${foundUid} → scope: subnet:${netuid}:validator`);
          } else {
            console.log(`  MINER: uid=${foundUid} → scope: subnet:${netuid}:miner`);
          }
        }

        if (alphaBalance > 0n) {
          console.log(`  HOLDER: ${alphaBalance} → scope: subnet:${netuid}:holder`);
        }

        console.log('');
      }
    } catch (err: any) {
      // Skip subnets that error
    }
  }

  console.log('Done.');
  await api.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
