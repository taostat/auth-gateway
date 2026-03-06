#!/usr/bin/env node

/**
 * Device Authorization Flow — CLI Example
 *
 * Usage:
 *   npx tsx device-auth.ts <client_id> [scope1 scope2 ...]
 *
 * Environment variables:
 *   AUTH_GATEWAY_URL  Base URL of the auth gateway (default: http://localhost:3000)
 *   CLIENT_ID         Client ID (overridden by CLI arg)
 *   SCOPES            Space-separated scopes (overridden by CLI args)
 */

import { exec } from "node:child_process";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

const BASE_URL = process.env.AUTH_GATEWAY_URL ?? "http://localhost:3000";
const args = process.argv.slice(2);
const CLIENT_ID = args[0] ?? process.env.CLIENT_ID;
const SCOPES = args.length > 1 ? args.slice(1) : (process.env.SCOPES?.split(" ").filter(Boolean) ?? []);

if (!CLIENT_ID) {
  console.error(red("Error: CLIENT_ID is required (pass as first CLI arg or set CLIENT_ID env var)"));
  process.exit(1);
}

function openBrowser(url: string) {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} "${url}"`, (err) => {
    if (err) console.log(dim("  Could not auto-open browser. Please open the URL manually."));
  });
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  const json = Buffer.from(part, "base64url").toString("utf-8");
  return JSON.parse(json);
}

type DevicePollResponse = {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

async function main() {
  console.log(bold("\n--- Device Authorization Flow ---\n"));
  console.log(dim(`  Gateway : ${BASE_URL}`));
  console.log(dim(`  Client  : ${CLIENT_ID}`));
  if (SCOPES.length) console.log(dim(`  Scopes  : ${SCOPES.join(" ")}`));
  console.log();

  // Step 1 — Request device code
  const codeRes = await fetch(`${BASE_URL}/v1/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, scopes: SCOPES }),
  });

  if (!codeRes.ok) {
    const body = await codeRes.json().catch(() => ({}));
    console.error(red(`Failed to request device code: ${codeRes.status}`), body);
    process.exit(1);
  }

  const { device_code, user_code, verification_uri, interval } = (await codeRes.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    interval: number;
  };

  const pollInterval = (interval ?? 5) * 1000;

  // Step 2 — Show code and open browser
  console.log(`  ${bold("User Code")}:  ${cyan(user_code)}`);
  console.log(`  ${bold("Verify at")}:  ${cyan(verification_uri)}\n`);
  openBrowser(verification_uri);
  console.log(dim("  Waiting for authorization"));

  // Step 3 — Poll for token
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const tokenRes = await fetch(`${BASE_URL}/v1/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: CLIENT_ID,
      }),
    });

    const body = (await tokenRes.json()) as DevicePollResponse;
    const oauthError = body.error;

    if (
      (tokenRes.status === 400 || tokenRes.status === 428)
      && (oauthError === "authorization_pending" || oauthError === "slow_down")
    ) {
      process.stdout.write(".");
      continue;
    }

    if (!tokenRes.ok) {
      console.log();
      console.error(red(`\n  Error: ${body.error ?? tokenRes.status}`));
      if (body.error_description) console.error(red(`  ${body.error_description}`));
      process.exit(1);
    }

    // Success
    console.log(green("\n\n  Authorized!\n"));

    const payload = decodeJwtPayload(body.access_token as string);
    console.log(bold("  Token details:"));
    console.log(`    Address : ${cyan(payload.sub as string)}`);
    console.log(`    Scopes  : ${cyan((payload.scope as string) || "(none)")}`);
    console.log(`    Expires : ${cyan(new Date((payload.exp as number) * 1000).toISOString())}`);

    console.log(dim("\n  Access token:"));
    console.log(dim(`    ${body.access_token}`));
    if (body.refresh_token) {
      console.log(dim("\n  Refresh token:"));
      console.log(dim(`    ${body.refresh_token}`));
    }
    console.log();
    break;
  }
}

main().catch((err) => {
  console.error(red(`\n  Fatal: ${err.message}`));
  process.exit(1);
});
