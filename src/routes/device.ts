import { randomInt, randomUUID } from 'node:crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChallenge, consumeChallenge } from '../crypto/challenge';
import { verifySignatureOrThrow } from '../crypto/signature';
import { validateAndNormalizeAddress, getClientSignMethod } from '../crypto/address';
import {
  verifyScopes,
  validateScopes,
  validateScopesForSignMethod,
  describeScopes,
  enforceClientScopes,
  resolveSignerContext,
} from '../scopes';
import { getClientById } from '../db/clients';
import {
  createDeviceCode as dbCreateDeviceCode,
  getDeviceCodeByUserCode,
  approveDeviceCode,
  cleanupExpiredDeviceCodes as dbCleanupExpired,
  clearDeviceCodes as dbClearDeviceCodes,
} from '../db/deviceCodes';
import { AuthError, DeviceCodeError } from '../util/errors';
import { config } from '../config';
import { DeviceCodeResponse } from '../types';
import {
  escapeHtml,
  walletBannersHtml,
  mobileDetectScript,
  walletCheckerScript,
  authHeaderHtml,
  poweredByHtml,
  starryBackgroundHtml,
} from '../util/html';
import { cssLinks } from '../styles';
import { testnetBannerHtml } from '../util/testnet';
import { applyHtmlSecurityHeaders, generateNonce } from './oauth/shared';
import { authenticateClient } from '../middleware/clientAuth';
import { enforceAllowedOriginForClient, sameOriginPreHandler } from '../middleware/origin';
import {
  DeviceCodeBodySchema,
  UserCodeQuerySchema,
  OptionalUserCodeQuerySchema,
  DeviceApproveBodySchema,
  DeviceConfirmBodySchema,
} from '../schemas/device';
import { DeviceCodeResponseSchema } from '../schemas/responses';

let cleanupInterval: NodeJS.Timeout | null = null;
let cleanupPromise: Promise<void> | null = null;

import { sameScopeSet } from '../util/scopes';

function generateUserCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O
  const nums = '0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[randomInt(chars.length)];
  code += '-';
  for (let i = 0; i < 4; i++) code += nums[randomInt(nums.length)];
  return code;
}

function isUniqueConstraintError(err: unknown): err is { code: string } {
  return (
    typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code?: unknown }).code === 'string'
  );
}

export function startDeviceCodeCleanup(intervalMs: number = 60000): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    cleanupPromise = dbCleanupExpired().catch((err) => {
      console.error('Device code cleanup error:', err.message);
    });
  }, intervalMs);
  if (cleanupInterval.unref) cleanupInterval.unref();
}

export async function waitForDeviceCodeCleanup(): Promise<void> {
  if (cleanupPromise) await cleanupPromise;
}

export function stopDeviceCodeCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

async function createUniqueDeviceCodeRecord(
  clientId: string,
  scopes: string[],
  expiresAt: Date,
): Promise<{ deviceCode: string; userCode: string }> {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const deviceCode = randomUUID();
    const userCode = generateUserCode();
    try {
      await dbCreateDeviceCode(deviceCode, userCode, clientId, scopes, expiresAt);
      return { deviceCode, userCode };
    } catch (err: unknown) {
      // Retry on unique collisions (user_code/device_code)
      if (isUniqueConstraintError(err) && err.code === '23505' && attempt < maxAttempts - 1) {
        continue;
      }
      throw err;
    }
  }
  throw new AuthError('Failed to generate unique device code', 503, 'Service Unavailable');
}

export async function clearDeviceCodes(): Promise<void> {
  await dbClearDeviceCodes();
}

export async function deviceRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /v1/device/code — request a new device code
  fastify.post(
    '/v1/device/code',
    {
      schema: {
        tags: ['Device Code'],
        summary: 'Request a device code',
        body: DeviceCodeBodySchema,
        response: { 200: DeviceCodeResponseSchema },
      },
    },
    async (
      request: FastifyRequest<{
        Body: z.infer<typeof DeviceCodeBodySchema>;
      }>,
      reply: FastifyReply,
    ) => {
      const { scopes = [] } = request.body;
      const { client } = await authenticateClient(request);
      enforceAllowedOriginForClient(request, client.allowed_origins);

      if (
        !client.grant_types.includes('urn:ietf:params:oauth:grant-type:device_code') &&
        !client.grant_types.includes('device_code')
      ) {
        throw new AuthError('Device code grant not allowed for this client', 400, 'Bad Request');
      }

      validateScopesForSignMethod(scopes, getClientSignMethod(client.allowed_sign_methods));

      if (scopes.length > 0) {
        validateScopes(scopes);
        enforceClientScopes(scopes, client.allowed_scopes);
      }

      const expiresAt = new Date(Date.now() + config.deviceCodeTtlSeconds * 1000);
      const { deviceCode, userCode } = await createUniqueDeviceCodeRecord(client.client_id, scopes, expiresAt);

      const response: DeviceCodeResponse = {
        device_code: deviceCode,
        user_code: userCode,
        verification_uri: config.verificationUri,
        expires_in: config.deviceCodeTtlSeconds,
        interval: config.deviceCodePollInterval,
      };

      return reply.code(200).send(response);
    },
  );

  // GET /v1/device/scopes — look up scopes for a user_code (used by the verify page)
  fastify.get<{
    Querystring: z.infer<typeof UserCodeQuerySchema>;
  }>(
    '/v1/device/scopes',
    {
      schema: {
        tags: ['Device Code'],
        summary: 'Look up scopes for a user code',
        querystring: UserCodeQuerySchema,
      },
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const { user_code } = request.query;

      const found = await getDeviceCodeByUserCode(user_code);
      if (found) {
        const deviceClient = await getClientById(found.clientId);
        return reply.code(200).send({
          scopes: found.scopes,
          descriptions: describeScopes(found.scopes),
          sign_method: getClientSignMethod(deviceClient?.allowed_sign_methods),
        });
      }

      return reply.code(404).send({ error: 'Invalid or expired user code' });
    },
  );

  // GET /v1/device/verify — page where user enters user_code and signs
  fastify.get(
    '/v1/device/verify',
    {
      schema: {
        tags: ['Device Code'],
        summary: 'User-facing approval page',
        querystring: OptionalUserCodeQuerySchema,
      },
    },
    async (
      request: FastifyRequest<{
        Querystring: z.infer<typeof OptionalUserCodeQuerySchema>;
      }>,
      reply: FastifyReply,
    ) => {
      const { user_code } = request.query;
      const cspNonce = generateNonce();

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Taostats Auth - Device Authorization</title>
  ${cssLinks}
</head>
<body class="narrow">
  ${starryBackgroundHtml(cspNonce)}
  ${testnetBannerHtml()}
  ${authHeaderHtml}
  ${walletBannersHtml()}
  <div class="auth-card">
    <h1>Device Authorization</h1>
    <p style="margin-bottom:1rem;color:var(--text-secondary);font-size:0.95rem;">Enter the code shown on your device:</p>
    <input class="code-input" type="text" id="user-code" placeholder="ABCD-1234" value="${escapeHtml(user_code || '')}" maxlength="9" />
    <div id="scopes-box" class="scopes-box" style="display:none;">
      <h3>Requested Permissions</h3>
      <div id="scopes-list"></div>
    </div>
    <div id="browser-flow">
      <div class="account-picker" id="account-picker" style="display:none;">
        <label>Select account:</label>
        <select class="account-select" id="account-select"></select>
      </div>
      <button class="btn-full" id="btn-authorize" disabled>Sign with Bittensor wallet</button>
      <div class="cli-toggle"><a id="link-show-cli">Sign with CLI</a></div>
    </div>
    <div id="cli-flow" class="cli-section" style="display:none;">
      <div class="cli-step">Step 1 &mdash; Sign the message</div>
      <div style="position:relative;">
        <div class="cmd-block" id="cli-cmd">Loading...</div>
        <button class="cmd-copy" id="btn-copy">Copy</button>
      </div>
      <p style="color:var(--text-muted);font-size:0.8rem;margin-top:6px;">Run this command in your terminal. btcli will prompt you to select a wallet and hotkey.</p>
      <div class="cli-step">Step 2 &mdash; Enter your signature and address</div>
      <label style="font-size:0.85rem;color:var(--text-secondary);">Signature</label>
      <textarea class="sig-input" id="cli-signature" placeholder="paste signature from btcli"></textarea>
      <label style="font-size:0.85rem;color:var(--text-secondary);margin-top:8px;display:block;">SS58 Address</label>
      <input class="addr-input" type="text" id="cli-address" placeholder="5Grw..." />
      <button class="btn-full" id="btn-cli-submit">Authorize</button>
      <div id="cli-refresh" style="display:none;text-align:center;margin-top:8px;">
        <a id="link-cli-refresh" style="cursor:pointer;">Get new challenge</a>
      </div>
      <div class="cli-toggle"><a id="link-show-browser">Back to browser wallet</a></div>
    </div>
    <div id="status" class="status"></div>
  </div>
  ${poweredByHtml}

  <script nonce="${cspNonce}" data-cfasync="false">
    let debounceTimer = null;
    let cliNonce = null;
    let cliExpiryTimer = null;
    let loadedScopes = [];
    let loadedSignMethod = 'sr25519';

    ${mobileDetectScript()}
    ${walletCheckerScript()}

    // Auto-load scopes if user_code is pre-filled
    if (document.getElementById('user-code').value.trim()) {
      loadScopes(document.getElementById('user-code').value.trim().toUpperCase());
    }

    function onCodeInput() {
      clearTimeout(debounceTimer);
      loadedScopes = [];
      cliNonce = null;
      var cliFl = document.getElementById('cli-flow');
      if (cliFl && cliFl.style.display !== 'none') {
        document.getElementById('cli-cmd').textContent = 'Enter code above, then click Sign with CLI';
        showBrowserFlow();
      }
      const val = document.getElementById('user-code').value.trim().toUpperCase();
      if (val.length === 9) {
        debounceTimer = setTimeout(() => loadScopes(val), 300);
      } else {
        document.getElementById('scopes-box').style.display = 'none';
      }
    }

    async function loadScopes(userCode) {
      try {
        const res = await fetch('/v1/device/scopes?user_code=' + encodeURIComponent(userCode));
        if (!res.ok) return;
        const data = await res.json();
        loadedScopes = data.scopes || [];
        loadedSignMethod = data.sign_method || 'sr25519';
        const box = document.getElementById('scopes-box');
        const list = document.getElementById('scopes-list');
        list.innerHTML = '';

        if (data.scopes.length === 0) {
          box.style.display = 'none';
        } else {
          data.scopes.forEach((scope, i) => {
            const div = document.createElement('div');
            div.className = 'scope-item';
            div.textContent = data.descriptions[i] + ' ';
            const raw = document.createElement('span');
            raw.className = 'raw';
            raw.textContent = scope;
            div.appendChild(raw);
            list.appendChild(div);
          });
          box.style.display = 'block';
        }

        WalletChecker.check(loadedSignMethod);
      } catch {}
    }

    function pickAccount(accounts) {
      return new Promise((resolve) => {
        const picker = document.getElementById('account-picker');
        const select = document.getElementById('account-select');
        const btn = document.getElementById('btn-authorize');
        select.innerHTML = '';
        accounts.forEach((a) => {
          const opt = document.createElement('option');
          opt.value = a.address;
          opt.textContent = (a.meta.name ? a.meta.name + ' \u2014 ' : '') + a.address;
          select.appendChild(opt);
        });
        picker.style.display = 'block';
        btn.textContent = 'Sign with selected account';
        btn.disabled = false;
        btn.onclick = () => {
          picker.style.display = 'none';
          btn.disabled = true;
          resolve(select.value);
        };
      });
    }

    async function connectAndSign() {
      const btn = document.getElementById('btn-authorize');
      btn.disabled = true;
      btn.textContent = 'Connecting...';
      const btnLabel = WalletChecker.configs[loadedSignMethod].label;
      try {
        const userCode = document.getElementById('user-code').value.trim().toUpperCase();
        if (!userCode) { showError('Please enter a code'); btn.disabled = false; btn.textContent = btnLabel; return; }

        var address, signature, nonce;

        if (loadedSignMethod === 'evm') {
          // Ethereum wallet flow
          if (!window.ethereum) { showError('No Ethereum wallet found'); btn.disabled = false; btn.textContent = btnLabel; return; }
          var ethAccounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
          if (!ethAccounts || ethAccounts.length === 0) { showError('No accounts found'); btn.disabled = false; btn.textContent = btnLabel; return; }

          if (ethAccounts.length > 1) {
            address = await pickAccount(ethAccounts.map(function(a) { return { address: a, meta: { name: '' } }; }));
          } else {
            address = ethAccounts[0];
          }

          btn.textContent = 'Signing...';

          var approveRes = await fetch('/v1/device/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_code: userCode, address: address }),
          });
          if (!approveRes.ok) { var e1 = await approveRes.json(); throw new Error(e1.message); }
          var approveData = await approveRes.json();
          nonce = approveData.nonce;

          signature = await window.ethereum.request({
            method: 'personal_sign',
            params: [nonce, address],
          });
        } else {
          // Taostats wallet flow
          const { web3Enable, web3Accounts, web3FromAddress } = await import('/static/extension-dapp.js');
          const extensions = await web3Enable('Taostats Auth');
          if (extensions.length === 0) {
            let walletCfg = WalletChecker.configs.sr25519;
            let walletInstalled = walletCfg.isAvailable();
            if (walletInstalled) {
              showError('Wallet extension detected but access was denied. Please allow access to Taostats Auth in your wallet extension and try again.');
              btn.textContent = btnLabel;
            } else {
              showError('No wallet extension found. Install the Taostats Wallet to sign with your browser.');
              let devBanner = document.getElementById(walletCfg.bannerId);
              if (devBanner) devBanner.style.display = 'flex';
              btn.textContent = walletCfg.noWalletLabel;
            }
            btn.disabled = false; return;
          }
          var polkaAccounts = await web3Accounts();
          if (polkaAccounts.length === 0) { showError('No accounts authorized. Open your wallet extension and allow access to at least one account.'); btn.disabled = false; btn.textContent = btnLabel; return; }

          if (polkaAccounts.length > 1) {
            address = await pickAccount(polkaAccounts);
          } else {
            address = polkaAccounts[0].address;
          }

          btn.textContent = 'Signing...';

          var res = await fetch('/v1/device/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_code: userCode, address: address }),
          });
          if (!res.ok) { var e2 = await res.json(); throw new Error(e2.message); }
          var resData = await res.json();
          nonce = resData.nonce;

          var injector = await web3FromAddress(address);
          var sigResult = await injector.signer.signRaw({
            address: address,
            data: nonce,
            type: 'bytes',
          });
          signature = sigResult.signature;
        }

        btn.textContent = 'Verifying...';

        // Confirm with signature
        const confirmRes = await fetch('/v1/device/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_code: userCode, address: address, nonce: nonce, signature: signature }),
        });

        if (!confirmRes.ok) { const e3 = await confirmRes.json(); throw new Error(e3.message); }

        showSuccess('Device authorized! You can close this window.');
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = btnLabel;
      }
    }

    async function showCliFlow() {
      const userCode = document.getElementById('user-code').value.trim().toUpperCase();
      if (!userCode) { showError('Please enter a code first'); return; }

      document.getElementById('browser-flow').style.display = 'none';
      document.getElementById('cli-flow').style.display = 'block';
      document.getElementById('cli-cmd').textContent = 'Requesting challenge...';
      document.getElementById('btn-cli-submit').disabled = false;
      document.getElementById('cli-refresh').style.display = 'none';

      try {
        // Ensure scopes are loaded before requesting challenge
        if (loadedScopes.length === 0) {
          const scopeRes = await fetch('/v1/device/scopes?user_code=' + encodeURIComponent(userCode));
          if (!scopeRes.ok) throw new Error('Unable to load requested permissions. Check the code and try again.');
          const scopeData = await scopeRes.json();
          loadedScopes = scopeData.scopes || [];
        }

        const res = await fetch('/v1/device/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_code: userCode }),
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
        const data = await res.json();
        cliNonce = data.nonce;
        document.getElementById('cli-cmd').textContent = "btcli wallet sign --message '" + data.nonce + "'";

        if (cliExpiryTimer) clearTimeout(cliExpiryTimer);
        const expiresMs = (data.expires_in || 120) * 1000;
        cliExpiryTimer = setTimeout(() => {
          var cmd = document.getElementById('cli-cmd');
          var submit = document.getElementById('btn-cli-submit');
          var refresh = document.getElementById('cli-refresh');
          if (cmd) cmd.textContent = 'Challenge expired. Click below to get a new one.';
          if (submit) submit.disabled = true;
          if (refresh) refresh.style.display = 'block';
        }, expiresMs);
      } catch (err) {
        showError(err.message);
        showBrowserFlow();
      }
    }

    function showBrowserFlow() {
      document.getElementById('browser-flow').style.display = 'block';
      document.getElementById('cli-flow').style.display = 'none';
      cliNonce = null;
      if (cliExpiryTimer) { clearTimeout(cliExpiryTimer); cliExpiryTimer = null; }
    }

    function copyCommand() {
      const text = document.getElementById('cli-cmd').textContent;
      navigator.clipboard.writeText(text).then(function() {
        const btn = document.querySelector('.cmd-copy');
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
      });
    }

    async function submitCliSignature() {
      const btn = document.getElementById('btn-cli-submit');
      btn.disabled = true;
      btn.textContent = 'Verifying...';
      try {
        const userCode = document.getElementById('user-code').value.trim().toUpperCase();
        const address = document.getElementById('cli-address').value.trim();
        const signature = document.getElementById('cli-signature').value.trim();

        if (!address) { showError('Please enter your SS58 address'); btn.disabled = false; btn.textContent = 'Authorize'; return; }
        if (!signature) { showError('Please enter the signature'); btn.disabled = false; btn.textContent = 'Authorize'; return; }
        if (!cliNonce) { showError('No challenge loaded. Please try again.'); btn.disabled = false; btn.textContent = 'Authorize'; return; }

        const confirmRes = await fetch('/v1/device/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_code: userCode, address, nonce: cliNonce, signature }),
        });
        if (!confirmRes.ok) { const e = await confirmRes.json(); throw new Error(e.message); }

        if (cliExpiryTimer) { clearTimeout(cliExpiryTimer); cliExpiryTimer = null; }
        showSuccess('Device authorized! You can close this window.');
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = 'Authorize';
      }
    }

    function showError(msg) {
      const el = document.getElementById('status');
      el.className = 'status error'; el.textContent = msg;
    }
    function showSuccess(msg) {
      const el = document.getElementById('status');
      el.className = 'status success'; el.textContent = msg;
    }

    // Event bindings
    document.querySelectorAll('.banner-close').forEach(function(el) {
      el.addEventListener('click', function() { this.parentElement.style.display = 'none'; });
    });
    document.getElementById('user-code').addEventListener('input', onCodeInput);
    document.getElementById('btn-authorize').addEventListener('click', connectAndSign);
    document.getElementById('link-show-cli').addEventListener('click', showCliFlow);
    document.getElementById('btn-copy').addEventListener('click', copyCommand);
    document.getElementById('btn-cli-submit').addEventListener('click', submitCliSignature);
    document.getElementById('link-cli-refresh').addEventListener('click', showCliFlow);
    document.getElementById('link-show-browser').addEventListener('click', showBrowserFlow);
  </script>
</body>
</html>`;

      return applyHtmlSecurityHeaders(reply, cspNonce).header('Content-Type', 'text/html').code(200).send(html);
    },
  );

  // POST /v1/device/approve — initiate approval (creates challenge for signing)
  fastify.post<{
    Body: z.infer<typeof DeviceApproveBodySchema>;
  }>(
    '/v1/device/approve',
    {
      preHandler: sameOriginPreHandler,
      schema: {
        tags: ['Device Code'],
        summary: 'Initiate device approval',
        body: DeviceApproveBodySchema,
      },
      config: {
        rateLimit: {
          max: config.rateLimitChallenge,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const { user_code, address: rawAddress } = request.body;

      const found = await getDeviceCodeByUserCode(user_code);

      if (!found) {
        throw new DeviceCodeError('Invalid or expired user code', 404);
      }

      // Look up client to determine sign method
      const approveClient = await getClientById(found.clientId);
      const clientMethod = getClientSignMethod(approveClient?.allowed_sign_methods);
      let address: string | null = null;
      if (rawAddress) {
        const normalized = validateAndNormalizeAddress(rawAddress);
        address = normalized.address;
        if (normalized.method !== clientMethod) {
          throw new AuthError(`This client requires ${clientMethod} wallet signing`, 400, 'Bad Request');
        }
      }

      if (new Date() > found.expiresAt) {
        throw new DeviceCodeError('Device code expired', 401);
      }

      const challenge = await createChallenge(address, found.scopes, {
        flowType: 'device',
        clientId: found.clientId,
        userCode: user_code,
      });

      return reply.code(200).send({ nonce: challenge.nonce });
    },
  );

  // POST /v1/device/confirm — confirm approval with signature
  fastify.post<{
    Body: z.infer<typeof DeviceConfirmBodySchema>;
  }>(
    '/v1/device/confirm',
    {
      preHandler: sameOriginPreHandler,
      schema: {
        tags: ['Device Code'],
        summary: 'Confirm device approval with signature',
        body: DeviceConfirmBodySchema,
      },
      config: {
        rateLimit: {
          max: config.rateLimitChallenge,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const { user_code, address: rawAddress, nonce, signature } = request.body;

      const { address, method } = validateAndNormalizeAddress(rawAddress);

      const found = await getDeviceCodeByUserCode(user_code);

      if (!found) {
        throw new DeviceCodeError('Invalid or expired user code', 404);
      }

      // Enforce client sign method
      const confirmClient = await getClientById(found.clientId);
      const confirmMethod = getClientSignMethod(confirmClient?.allowed_sign_methods);
      if (method !== confirmMethod) {
        throw new AuthError(`This client requires ${confirmMethod} wallet signing`, 400, 'Bad Request');
      }
      validateScopesForSignMethod(found.scopes, confirmMethod);

      // Consume challenge and verify signature (method-aware)
      const challenge = await consumeChallenge(nonce);

      if (challenge.flowType !== 'device') {
        throw new AuthError('Challenge was created for a different authentication flow', 400, 'Bad Request');
      }
      if (challenge.userCode !== user_code) {
        throw new AuthError('user_code mismatch', 400, 'Bad Request');
      }
      if (!sameScopeSet(challenge.scopes, found.scopes)) {
        throw new AuthError('Challenge scope mismatch', 400, 'Bad Request');
      }

      if (challenge.address && challenge.address !== address) {
        throw new AuthError('Address mismatch', 401, 'Unauthorized');
      }

      await verifySignatureOrThrow(nonce, signature, address, method);

      // Resolve signer context and verify scopes (skip for EVM)
      const isEvm = method === 'evm';
      if (!isEvm) {
        const signerCtx = await resolveSignerContext(address);
        if (found.scopes.length > 0) {
          await verifyScopes(signerCtx, found.scopes);
        }
      }

      // Mark as approved in DB
      const approved = await approveDeviceCode(user_code, address);
      if (!approved) {
        throw new DeviceCodeError('Device code expired or already used', 409);
      }

      return reply.code(200).send({ status: 'approved' });
    },
  );
}
