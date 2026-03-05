import { ApiPromise, WsProvider } from '@polkadot/api';
import { config } from '../config';

let api: ApiPromise | null = null;
let connectionPromise: Promise<ApiPromise> | null = null;

export async function getSubtensorApi(): Promise<ApiPromise> {
  if (api && api.isConnected) return api;

  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
      const provider = new WsProvider(config.subtensorWsUrl);
      // WsProvider.ttl type mismatch in @polkadot/api v16
      api = await ApiPromise.create({ provider: provider as any, noInitWarn: true });

      api.on('disconnected', () => {
        console.warn('Subtensor WebSocket disconnected, will reconnect on next request');
        api = null;
        connectionPromise = null;
      });

      api.on('error', (err: Error) => {
        console.error('Subtensor WebSocket error:', err.message);
      });

      console.log('Connected to Subtensor at', config.subtensorWsUrl);
      return api;
    } catch (err) {
      connectionPromise = null;
      throw err;
    }
  })();

  return connectionPromise;
}

export async function disconnectSubtensor(): Promise<void> {
  if (api) {
    await api.disconnect();
    api = null;
    connectionPromise = null;
  }
}

export function isSubtensorConnected(): boolean {
  return api !== null && api.isConnected;
}
