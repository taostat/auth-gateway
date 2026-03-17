/**
 * CLI tool to create an OAuth client directly via the database.
 *
 * Usage:
 *   npx tsx scripts/create-client.ts --name "My App" --type confidential --redirect-uri http://localhost:3001/callback
 *   npx tsx scripts/create-client.ts --name "CLI Tool" --type public --redirect-uri http://localhost:3001/callback --grant-type device_code
 *
 * Options:
 *   --name          Client name (required)
 *   --type          Client type: confidential or public (default: confidential)
 *   --redirect-uri  Redirect URI(s), can be repeated (required)
 *   --grant-type    Grant type(s), can be repeated (default: authorization_code)
 *   --origin        Allowed origin(s) for CORS, can be repeated
 *   --scope         Allowed scope(s), can be repeated
 *   --sign-method   Sign method: sr25519 or evm (default: sr25519)
 *   --rate-limit    Rate limit per minute (default: 60)
 */

import dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import crypto from 'crypto';

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function parseArgs(args: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  let current: string | null = null;

  for (const arg of args) {
    if (arg.startsWith('--')) {
      current = arg.slice(2);
      if (!result[current]) result[current] = [];
    } else if (current) {
      result[current].push(arg);
    }
  }
  return result;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  const name = parsed['name']?.[0];
  const type = (parsed['type']?.[0] || 'confidential') as 'confidential' | 'public';
  const redirectUris = parsed['redirect-uri'] || [];
  const grantTypes = parsed['grant-type'] || ['authorization_code'];
  const origins = parsed['origin'] || [];
  const scopes = parsed['scope'] || [];
  const signMethod = parsed['sign-method']?.[0] || 'sr25519';
  const rateLimit = parseInt(parsed['rate-limit']?.[0] || '60', 10);

  if (!name) {
    console.error(red('Error: --name is required'));
    console.log(dim('Usage: npx tsx scripts/create-client.ts --name "My App" --type confidential --redirect-uri http://localhost:3001/callback'));
    process.exit(1);
  }

  if (redirectUris.length === 0) {
    console.error(red('Error: at least one --redirect-uri is required'));
    process.exit(1);
  }

  if (!['confidential', 'public'].includes(type)) {
    console.error(red('Error: --type must be "confidential" or "public"'));
    process.exit(1);
  }

  if (!['sr25519', 'evm'].includes(signMethod)) {
    console.error(red('Error: --sign-method must be "sr25519" or "evm"'));
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL || 'postgresql://auth:auth_dev_password@localhost:5432/auth_gateway';
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    let secretHash: string | null = null;
    let plainSecret: string | undefined;

    if (type === 'confidential') {
      plainSecret = crypto.randomBytes(32).toString('hex');
      const salt = crypto.randomBytes(16);
      const N = 16384, r = 8, p = 1, keylen = 64;
      const derived = await new Promise<Buffer>((resolve, reject) => {
        crypto.scrypt(plainSecret!, salt, keylen, { N, r, p }, (err, key) => {
          if (err) reject(err); else resolve(key as Buffer);
        });
      });
      secretHash = `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
    }

    const { rows } = await pool.query(
      `INSERT INTO oauth_clients (client_secret_hash, client_name, client_type, redirect_uris, grant_types, allowed_scopes, allowed_origins, allowed_sign_methods, rate_limit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING client_id`,
      [secretHash, name, type, redirectUris, grantTypes, scopes, origins, [signMethod], rateLimit],
    );

    const clientId = rows[0].client_id;

    console.log(`\n${green('Client created successfully!')}\n`);
    console.log(`${bold('Client ID:')}     ${cyan(clientId)}`);
    if (plainSecret) {
      console.log(`${bold('Client Secret:')} ${cyan(plainSecret)}`);
      console.log(dim('\nSave the client_secret now — it cannot be retrieved later.'));
    }
    console.log(`\n${bold('Name:')}          ${name}`);
    console.log(`${bold('Type:')}          ${type}`);
    console.log(`${bold('Redirect URIs:')} ${redirectUris.join(', ')}`);
    console.log(`${bold('Grant Types:')}   ${grantTypes.join(', ')}`);
    console.log(`${bold('Sign Method:')}  ${signMethod}`);
    if (origins.length > 0) console.log(`${bold('Origins:')}       ${origins.join(', ')}`);
    if (scopes.length > 0) console.log(`${bold('Scopes:')}        ${scopes.join(', ')}`);
    console.log(`${bold('Rate Limit:')}    ${rateLimit}/min`);
    console.log();
  } catch (err: any) {
    console.error(red('Failed to create client:'), err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
