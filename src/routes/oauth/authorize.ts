import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { consumeChallenge } from '../../crypto/challenge';
import { verifySignatureOrThrow } from '../../crypto/signature';
import { createAuthCode } from '../../crypto/jwt';
import { validateCodeChallenge } from '../../crypto/pkce';
import { verifyScopes, validateScopes, describeScopes, enforceClientScopes, resolveSignerContext } from '../../scopes';
import { getClientById } from '../../db/clients';
import { AuthError, InvalidAddressError } from '../../util/errors';
import { config } from '../../config';
import { OAuthClient } from '../../types';
import { escapeHtml, serializeForInlineScript, walletBannerHtml, checkWalletScript, authHeaderHtml, poweredByHtml, starryBackgroundHtml } from '../../util/html';
import { isValidSS58, applyHtmlSecurityHeaders, sendHtmlError, generateNonce } from './shared';
import { cssLinks } from '../../styles';
import { testnetBannerHtml } from '../../util/testnet';
import { AuthorizeQuerySchema, CallbackBodySchema } from '../../schemas/oauth';

export async function authorizeRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /v1/oauth/authorize
  fastify.get('/v1/oauth/authorize', {
    schema: {
      tags: ['OAuth'],
      summary: 'Authorization page (browser redirect)',
      querystring: AuthorizeQuerySchema,
    },
  }, async (request: FastifyRequest<{
    Querystring: z.infer<typeof AuthorizeQuerySchema>;
  }>, reply: FastifyReply) => {
    const { client_id, redirect_uri, scope, state, response_type, code_challenge, code_challenge_method, nonce: oidcNonce } = request.query;

    if (!client_id || !redirect_uri) {
      return sendHtmlError(reply, 400, 'Bad Request', 'Missing required parameters: client_id and redirect_uri');
    }

    if (response_type && response_type !== 'code') {
      return sendHtmlError(reply, 400, 'Bad Request', 'Unsupported response_type. Only "code" is supported.');
    }

    // Validate client_id
    let client: OAuthClient | null;
    try {
      client = await getClientById(client_id);
    } catch {
      client = null;
    }

    if (!client) {
      return sendHtmlError(reply, 400, 'Unknown Application', 'The client_id provided is not registered.');
    }

    // Validate redirect_uri against registered URIs
    if (!client.redirect_uris.includes(redirect_uri)) {
      return sendHtmlError(reply, 400, 'Invalid Redirect', 'The redirect_uri is not registered for this application.');
    }

    // Public clients must use PKCE
    if (client.client_type === 'public') {
      if (!code_challenge || code_challenge_method !== 'S256') {
        return sendHtmlError(reply, 400, 'PKCE Required', 'Public clients must provide code_challenge with code_challenge_method=S256.');
      }
    }

    // Validate code_challenge_method if provided
    if (code_challenge_method && code_challenge_method !== 'S256') {
      return sendHtmlError(reply, 400, 'Bad Request', 'Only code_challenge_method=S256 is supported.');
    }

    // Validate code_challenge format if provided
    if (code_challenge && !validateCodeChallenge(code_challenge)) {
      return sendHtmlError(reply, 400, 'Bad Request', 'Invalid code_challenge format. Must be a 43-character base64url string.');
    }

    const scopes = scope ? scope.split(' ') : [];
    if (scopes.length > 0) {
      try {
        validateScopes(scopes);
      } catch (err) {
        return sendHtmlError(reply, 400, 'Invalid Scopes', (err as Error).message);
      }
      try {
        enforceClientScopes(scopes, client.allowed_scopes);
      } catch (err) {
        return sendHtmlError(reply, 403, 'Forbidden', (err as Error).message);
      }
    }

    const scopeDescriptions = describeScopes(scopes);

    const cspNonce = generateNonce();

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Taostats Auth - Authorize</title>
  ${cssLinks}
</head>
<body class="narrow">
  ${starryBackgroundHtml(cspNonce)}
  ${testnetBannerHtml()}
  ${authHeaderHtml}
  ${walletBannerHtml()}
  <div class="auth-card">
    <h1>Authorize access</h1>
    <p class="info"><strong>${escapeHtml(client.client_name)}</strong> wants to verify your wallet identity. You will sign a message to prove ownership — no transaction will be made.</p>
    ${scopes.length > 0 ? `<div class="scopes-box">
      <h3>Access requested</h3>
      ${scopes.map((s, i) => `<div class="scope-item"><span>${escapeHtml(scopeDescriptions[i] ?? s)}</span> <span class="raw">${escapeHtml(s)}</span></div>`).join('')}
    </div>` : ''}
    <div id="browser-flow">
      <div class="account-picker" id="account-picker" style="display:none;">
        <label>Select account:</label>
        <select class="account-select" id="account-select"></select>
      </div>
      <div class="btn-row">
        <button class="btn-deny" id="btn-deny">Deny</button>
        <button class="btn-authorize" id="btn-authorize" disabled>Sign with browser wallet</button>
      </div>
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
      <div class="btn-row">
        <button class="btn-deny" id="btn-cli-deny">Deny</button>
        <button class="btn-authorize" id="btn-cli-submit">Authorize</button>
      </div>
      <div id="cli-refresh" style="display:none;text-align:center;margin-top:8px;">
        <a id="link-cli-refresh" style="cursor:pointer;">Get new challenge</a>
      </div>
      <div class="cli-toggle"><a id="link-show-browser">Back to browser wallet</a></div>
    </div>
    <div id="status" class="status"></div>
  </div>
  ${poweredByHtml}

  <script nonce="${cspNonce}" data-cfasync="false">
    const CONFIG = {
      clientId: ${serializeForInlineScript(client_id)},
      redirectUri: ${serializeForInlineScript(redirect_uri)},
      state: ${serializeForInlineScript(state || '')},
      scopes: ${serializeForInlineScript(scopes)},
      codeChallenge: ${serializeForInlineScript(code_challenge || '')},
      oidcNonce: ${serializeForInlineScript(oidcNonce || '')},
    };

    let cliNonce = null;
    let cliExpiryTimer = null;

    ${checkWalletScript()}

    function deny() {
      const params = new URLSearchParams({ error: 'access_denied' });
      if (CONFIG.state) params.set('state', CONFIG.state);
      window.location.href = CONFIG.redirectUri + '?' + params.toString();
    }

    function cliDeny() {
      if (cliExpiryTimer) { clearTimeout(cliExpiryTimer); cliExpiryTimer = null; }
      deny();
    }

    async function authorize() {
      const btn = document.getElementById('btn-authorize');
      btn.disabled = true;
      btn.textContent = 'Connecting...';
      try {
        const { web3Enable, web3Accounts, web3FromAddress } = await import('/static/extension-dapp.js');
        const extensions = await web3Enable('Taostats Auth');
        if (extensions.length === 0) {
          showError('No wallet extension found');
          btn.textContent = 'No wallet detected';
          var banner = document.getElementById('wallet-banner');
          if (banner) banner.style.display = 'flex';
          return;
        }
        const accounts = await web3Accounts();
        if (accounts.length === 0) { showError('No accounts found'); btn.disabled = false; btn.textContent = 'Sign with browser wallet'; return; }

        let address;
        if (accounts.length > 1) {
          address = await pickAccount(accounts);
        } else {
          address = accounts[0].address;
        }

        btn.textContent = 'Signing...';

        // Request challenge
        const challengeRes = await fetch('/v1/auth/challenge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, scopes: CONFIG.scopes }),
        });
        if (!challengeRes.ok) { const e = await challengeRes.json(); throw new Error(e.message); }
        const { nonce } = await challengeRes.json();

        // Sign with extension
        const injector = await web3FromAddress(address);
        const { signature } = await injector.signer.signRaw({
          address,
          data: nonce,
          type: 'bytes',
        });

        btn.textContent = 'Verifying...';

        // Verify and get auth code
        const verifyRes = await fetch('/v1/oauth/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nonce,
            address,
            signature,
            client_id: CONFIG.clientId,
            redirect_uri: CONFIG.redirectUri,
            code_challenge: CONFIG.codeChallenge || undefined,
            oidc_nonce: CONFIG.oidcNonce || undefined,
          }),
        });
        if (!verifyRes.ok) { const e = await verifyRes.json(); throw new Error(e.message); }
        const { code } = await verifyRes.json();

        // Redirect back with code
        const params = new URLSearchParams({ code });
        if (CONFIG.state) params.set('state', CONFIG.state);
        window.location.href = CONFIG.redirectUri + '?' + params.toString();
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = 'Sign with browser wallet';
      }
    }

    async function showCliFlow() {
      document.getElementById('browser-flow').style.display = 'none';
      document.getElementById('cli-flow').style.display = 'block';
      document.getElementById('cli-cmd').textContent = 'Requesting challenge...';
      document.getElementById('btn-cli-submit').disabled = false;
      document.getElementById('cli-refresh').style.display = 'none';

      try {
        const challengeRes = await fetch('/v1/auth/challenge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scopes: CONFIG.scopes }),
        });
        if (!challengeRes.ok) { const e = await challengeRes.json(); throw new Error(e.message); }
        const data = await challengeRes.json();
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
        var btn = document.querySelector('.cmd-copy');
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
      });
    }

    async function submitCliSignature() {
      const btn = document.getElementById('btn-cli-submit');
      btn.disabled = true;
      btn.textContent = 'Verifying...';
      try {
        const address = document.getElementById('cli-address').value.trim();
        const signature = document.getElementById('cli-signature').value.trim();

        if (!address) { showError('Please enter your SS58 address'); btn.disabled = false; btn.textContent = 'Authorize'; return; }
        if (!signature) { showError('Please enter the signature'); btn.disabled = false; btn.textContent = 'Authorize'; return; }
        if (!cliNonce) { showError('No challenge loaded. Please try again.'); btn.disabled = false; btn.textContent = 'Authorize'; return; }

        const verifyRes = await fetch('/v1/oauth/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nonce: cliNonce,
            address,
            signature,
            client_id: CONFIG.clientId,
            redirect_uri: CONFIG.redirectUri,
            code_challenge: CONFIG.codeChallenge || undefined,
            oidc_nonce: CONFIG.oidcNonce || undefined,
          }),
        });
        if (!verifyRes.ok) { const e = await verifyRes.json(); throw new Error(e.message); }
        const { code } = await verifyRes.json();

        if (cliExpiryTimer) { clearTimeout(cliExpiryTimer); cliExpiryTimer = null; }
        const params = new URLSearchParams({ code });
        if (CONFIG.state) params.set('state', CONFIG.state);
        window.location.href = CONFIG.redirectUri + '?' + params.toString();
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = 'Authorize';
      }
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

    function showError(msg) {
      const el = document.getElementById('status');
      el.className = 'status error';
      el.textContent = msg;
    }

    // Event bindings
    var bannerClose = document.getElementById('banner-close');
    if (bannerClose) bannerClose.addEventListener('click', function() { this.parentElement.style.display = 'none'; });
    document.getElementById('btn-deny').addEventListener('click', deny);
    document.getElementById('btn-authorize').addEventListener('click', authorize);
    document.getElementById('link-show-cli').addEventListener('click', showCliFlow);
    document.getElementById('btn-copy').addEventListener('click', copyCommand);
    document.getElementById('btn-cli-deny').addEventListener('click', cliDeny);
    document.getElementById('btn-cli-submit').addEventListener('click', submitCliSignature);
    document.getElementById('link-cli-refresh').addEventListener('click', showCliFlow);
    document.getElementById('link-show-browser').addEventListener('click', showBrowserFlow);
  </script>
</body>
</html>`;

    return applyHtmlSecurityHeaders(reply, cspNonce).header('Content-Type', 'text/html').code(200).send(html);
  });

  // POST /v1/oauth/callback — internal endpoint used by the authorize page
  fastify.post('/v1/oauth/callback', {
    schema: {
      tags: ['OAuth'],
      summary: 'Exchange signature for auth code',
      body: CallbackBodySchema,
    },
    config: {
      rateLimit: {
        max: config.rateLimitChallenge,
        timeWindow: '1 minute',
      },
    },
  }, async (request: FastifyRequest<{
    Body: z.infer<typeof CallbackBodySchema>;
  }>, reply: FastifyReply) => {
    const { nonce, address, signature, client_id, redirect_uri, code_challenge, oidc_nonce } = request.body;

    if (!isValidSS58(address)) {
      throw new InvalidAddressError();
    }

    // Consume challenge
    const challenge = await consumeChallenge(nonce);

    if (challenge.address && challenge.address !== address) {
      throw new AuthError('Address mismatch', 401, 'Unauthorized');
    }

    // Verify signature
    verifySignatureOrThrow(nonce, signature, address);

    // Resolve signer context for scope verification and JWT claims
    const signerCtx = await resolveSignerContext(address);

    if (challenge.scopes.length > 0) {
      await verifyScopes(signerCtx, challenge.scopes);
    }

    // Validate client and enforce scope restrictions
    const callbackClient = await getClientById(client_id);
    if (!callbackClient) {
      throw new AuthError('Unknown client_id', 400, 'Bad Request');
    }
    if (callbackClient.redirect_uris.length > 0) {
      if (!redirect_uri) {
        throw new AuthError('redirect_uri is required', 400, 'Bad Request');
      }
      if (!callbackClient.redirect_uris.includes(redirect_uri)) {
        throw new AuthError('redirect_uri not registered for this client', 400, 'Bad Request');
      }
    }
    if (challenge.scopes.length > 0) {
      enforceClientScopes(challenge.scopes, callbackClient.allowed_scopes);
    }

    if (code_challenge && !validateCodeChallenge(code_challenge)) {
      throw new AuthError('Invalid code_challenge format', 400, 'Bad Request');
    }

    // Create auth code with client context embedded
    const code = createAuthCode(address, challenge.scopes, {
      client_id,
      redirect_uri,
      code_challenge,
      nonce: oidc_nonce,
      auth_time: Math.floor(Date.now() / 1000),
      hotkey: signerCtx.hotkey,
      coldkey: signerCtx.coldkey,
    });

    return reply.code(200).send({ code });
  });
}
