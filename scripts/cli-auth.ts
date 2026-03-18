/**
 * CLI auth tool — initiates the device code flow, opens the browser,
 * and polls until the user approves with their wallet.
 *
 * Usage:
 *   npx tsx scripts/cli-auth.ts [scopes...]
 *   npx tsx scripts/cli-auth.ts --client-id <id> [scopes...]
 *
 * Examples:
 *   npx tsx scripts/cli-auth.ts --client-id my-client-id                           # no scopes
 *   npx tsx scripts/cli-auth.ts --client-id my-client-id subnet:1:miner            # single scope
 *   AUTH_CLIENT_SECRET=abc123 npx tsx scripts/cli-auth.ts --client-id my-client-id subnet:1:validator  # with secret
 */

import dotenv from 'dotenv';
dotenv.config();

import { exec } from 'child_process';

const BASE_URL = process.env.AUTH_URL || 'http://localhost:3000';

// Parse arguments
let clientId = process.env.AUTH_CLIENT_ID || '';
let clientSecret = process.env.AUTH_CLIENT_SECRET || '';
const scopes: string[] = [];

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--client-id' && args[i + 1]) {
    clientId = args[++i];
  } else if (!args[i].startsWith('--')) {
    scopes.push(args[i]);
  }
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

type DevicePollResponse = {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

function decodeJwtPayload(token: string): any {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString());
}

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

async function main() {
  console.log(`\n${bold('Taostats Auth — Device Code Flow')}\n`);

  if (!clientId) {
    console.error(red('Error: --client-id is required (or set AUTH_CLIENT_ID env var)'));
    console.log(dim('Usage: npx tsx scripts/cli-auth.ts --client-id <id> [scopes...]'));
    console.log(dim('Note: Use AUTH_CLIENT_SECRET env var to provide client secret'));
    process.exit(1);
  }

  console.log(`Client: ${cyan(clientId)}`);
  if (scopes.length > 0) {
    console.log(`Scopes: ${cyan(scopes.join(', '))}`);
  }

  // 1. Request device code
  const codeRes = await fetch(`${BASE_URL}/v1/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scopes }),
  });

  if (!codeRes.ok) {
    const err = await codeRes.json().catch(() => null);
    console.error(red(`Failed to request device code: ${codeRes.status}`));
    if (err) console.error(dim(JSON.stringify(err)));
    process.exit(1);
  }

  const { device_code, user_code, verification_uri, expires_in, interval } = await codeRes.json();

  const verifyUrl = `${verification_uri}?user_code=${user_code}`;

  console.log(`\nOpen this URL in your browser to authorize:\n`);
  console.log(`  ${bold(verifyUrl)}\n`);
  console.log(`Your code: ${bold(user_code)}`);
  console.log(dim(`Expires in ${expires_in}s. Polling every ${interval}s...\n`));

  // 2. Open browser
  openBrowser(verifyUrl);

  // 3. Poll for token
  const deadline = Date.now() + expires_in * 1000;

  // Build poll body with client credentials
  const pollBody: Record<string, unknown> = {
    device_code,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: clientId,
  };
  if (clientSecret) {
    pollBody.client_secret = clientSecret;
  }

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval * 1000));

    const pollRes = await fetch(`${BASE_URL}/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pollBody),
    });

    const data = (await pollRes.json().catch(() => null)) as DevicePollResponse | null;
    const oauthError = data?.error;

    if (
      (pollRes.status === 400 || pollRes.status === 428) &&
      (oauthError === 'authorization_pending' || oauthError === 'slow_down')
    ) {
      process.stdout.write(dim('.'));
      continue;
    }

    if (pollRes.status === 200 && typeof data?.access_token === 'string') {
      console.log(`\n\n${green('Authorized!')}\n`);

      const claims = decodeJwtPayload(data.access_token);
      console.log(`${bold('Address:')}  ${claims.sub}`);
      console.log(`${bold('Scopes:')}   ${(claims.scope as string) || 'none'}`);
      console.log(`${bold('Expires:')}  ${new Date(claims.exp * 1000).toISOString()}`);
      console.log(`\n${bold('Access Token:')}\n${dim(data.access_token)}\n`);
      if (typeof data.refresh_token === 'string') {
        console.log(`${bold('Refresh Token:')}\n${dim(data.refresh_token)}\n`);
      }
      process.exit(0);
    }

    // Any other error
    console.log(`\n\n${red(`Auth failed: ${pollRes.status}`)}`);
    if (data) console.log(dim(JSON.stringify(data)));
    process.exit(1);
  }

  console.log(`\n\n${red('Device code expired.')}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(red('Fatal:'), err.message);
  process.exit(1);
});
