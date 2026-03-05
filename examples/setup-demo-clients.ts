#!/usr/bin/env npx tsx
/**
 * Register demo OAuth clients via the admin API.
 * No external dependencies — uses Node 18+ built-in fetch.
 *
 * Usage:
 *   npx tsx examples/setup-demo-clients.ts
 *   npx tsx examples/setup-demo-clients.ts --url http://localhost:3000 --key your-admin-key
 *
 * Environment variables:
 *   AUTH_GATEWAY_URL  Gateway base URL (default: http://localhost:3000)
 *   ADMIN_API_KEY     Admin API key (required)
 */

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

// Parse CLI args
let gatewayUrl = process.env.AUTH_GATEWAY_URL || 'http://localhost:3000';
let adminKey = process.env.ADMIN_API_KEY || '';

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--url' || args[i] === '-u') && args[i + 1]) {
    gatewayUrl = args[++i];
  } else if ((args[i] === '--key' || args[i] === '-k') && args[i + 1]) {
    adminKey = args[++i];
  }
}

if (!adminKey) {
  console.error(red('Error: ADMIN_API_KEY is required.'));
  console.log(dim('Usage: npx tsx examples/setup-demo-clients.ts --key YOUR_ADMIN_KEY'));
  console.log(dim('       or set the ADMIN_API_KEY environment variable.'));
  process.exit(1);
}

interface ClientDef {
  label: string;
  example: string;
  body: Record<string, unknown>;
}

const clients: ClientDef[] = [
  {
    label: 'Example Web App',
    example: 'web-app-raw',
    body: {
      client_name: 'Example Web App',
      client_type: 'public',
      redirect_uris: ['http://localhost:8080'],
      grant_types: ['authorization_code'],
      allowed_origins: ['http://localhost:8080'],
    },
  },
  {
    label: 'Example OIDC Web App',
    example: 'web-app-oidc',
    body: {
      client_name: 'Example OIDC Web App',
      client_type: 'public',
      redirect_uris: ['http://localhost:5173'],
      grant_types: ['authorization_code'],
      allowed_origins: ['http://localhost:5173'],
    },
  },
  {
    label: 'Example CLI',
    example: 'cli-device-code',
    body: {
      client_name: 'Example CLI',
      client_type: 'public',
      redirect_uris: [],
      grant_types: ['urn:ietf:params:oauth:grant-type:device_code'],
    },
  },
];

async function registerClient(def: ClientDef): Promise<string | null> {
  try {
    const res = await fetch(`${gatewayUrl}/v1/admin/clients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-API-Key': adminKey,
      },
      body: JSON.stringify(def.body),
    });

    const data = await res.json() as Record<string, unknown>;

    if (!res.ok) {
      console.log(`  ${red('FAILED')}: ${data.message || res.status}`);
      return null;
    }

    const clientId = data.client_id as string;
    console.log(`  ${green('OK')} client_id: ${cyan(clientId)}`);
    return clientId;
  } catch (err: any) {
    console.log(`  ${red('ERROR')}: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log(`\n${bold('Registering demo clients')} against ${cyan(gatewayUrl)}\n`);

  const results: { example: string; clientId: string }[] = [];

  for (const def of clients) {
    console.log(`${bold(def.label)} (${def.example}/)`);
    const clientId = await registerClient(def);
    if (clientId) {
      results.push({ example: def.example, clientId });
    }
    console.log();
  }

  if (results.length > 0) {
    console.log(`${bold('Summary')} — copy these client IDs into each example:\n`);
    for (const r of results) {
      console.log(`  ${r.example.padEnd(20)} CLIENT_ID=${cyan(r.clientId)}`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error(red(`Fatal: ${err.message}`));
  process.exit(1);
});
