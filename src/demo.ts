import { createClient, listClients } from './db/clients';

const DEMO_WEB_CLIENT_NAME = 'Demo Web App';
const DEMO_CLI_CLIENT_NAME = 'Demo CLI';

export interface DemoClients {
  webClientId: string;
  cliClientId: string;
}

/**
 * Ensure demo clients exist in the database. Creates them if missing.
 * Returns the client IDs for use by the landing page.
 */
export async function ensureDemoClients(publicUrl: string): Promise<DemoClients> {
  const clients = await listClients();

  // Find or create web app client
  let webClient = clients.find((c) => c.client_name === DEMO_WEB_CLIENT_NAME && c.active);
  if (!webClient) {
    const origin = publicUrl.replace(/\/$/, '');
    const { client } = await createClient({
      client_name: DEMO_WEB_CLIENT_NAME,
      client_type: 'public',
      redirect_uris: [`${origin}/`],
      grant_types: ['authorization_code'],
      allowed_scopes: [],
      allowed_origins: [origin],
    });
    webClient = client;
    console.log(`Created demo web client: ${client.client_id}`);
  }

  // Find or create CLI client
  let cliClient = clients.find((c) => c.client_name === DEMO_CLI_CLIENT_NAME && c.active);
  if (!cliClient) {
    const { client } = await createClient({
      client_name: DEMO_CLI_CLIENT_NAME,
      client_type: 'public',
      redirect_uris: [],
      grant_types: ['urn:ietf:params:oauth:grant-type:device_code'],
      allowed_scopes: [],
      allowed_origins: [],
    });
    cliClient = client;
    console.log(`Created demo CLI client: ${client.client_id}`);
  }

  return {
    webClientId: webClient.client_id,
    cliClientId: cliClient.client_id,
  };
}
