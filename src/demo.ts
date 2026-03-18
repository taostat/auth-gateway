import { createClient, listClients } from './db/clients';
import { OAuthClient } from './types';

const DEMO_WEB_CLIENT_NAME = 'Demo Web App';
const DEMO_EVM_CLIENT_NAME = 'Demo EVM Web App';
const DEMO_CLI_CLIENT_NAME = 'Demo CLI';

export interface DemoClients {
  bittensorClientId: string;
  evmClientId: string;
  cliClientId: string;
}

async function findOrCreateClient(
  existing: OAuthClient[],
  name: string,
  opts: Omit<Parameters<typeof createClient>[0], 'client_name'>,
): Promise<OAuthClient> {
  const found = existing.find((c) => c.client_name === name && c.active);
  if (found) return found;
  const { client } = await createClient({ client_name: name, ...opts });
  console.log(`Created demo client ${name}: ${client.client_id}`);
  return client;
}

/**
 * Ensure demo clients exist in the database. Creates them if missing.
 * Returns the client IDs for use by the landing page.
 */
export async function ensureDemoClients(publicUrl: string): Promise<DemoClients> {
  const clients = await listClients();
  const origin = publicUrl.replace(/\/$/, '');

  const [webClient, evmClient, cliClient] = await Promise.all([
    findOrCreateClient(clients, DEMO_WEB_CLIENT_NAME, {
      client_type: 'public',
      redirect_uris: [`${origin}/`],
      grant_types: ['authorization_code'],
      allowed_scopes: [],
      allowed_origins: [origin],
    }),
    findOrCreateClient(clients, DEMO_EVM_CLIENT_NAME, {
      client_type: 'public',
      redirect_uris: [`${origin}/`],
      grant_types: ['authorization_code'],
      allowed_scopes: ['openid'],
      allowed_origins: [origin],
      allowed_sign_methods: ['evm'],
    }),
    findOrCreateClient(clients, DEMO_CLI_CLIENT_NAME, {
      client_type: 'public',
      redirect_uris: [],
      grant_types: ['urn:ietf:params:oauth:grant-type:device_code'],
      allowed_scopes: [],
      allowed_origins: [],
    }),
  ]);

  return {
    bittensorClientId: webClient.client_id,
    evmClientId: evmClient.client_id,
    cliClientId: cliClient.client_id,
  };
}
