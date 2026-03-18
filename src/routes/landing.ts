import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { config } from '../config';

/**
 * Resolve the static assets directory.
 * In production (esbuild bundle): dist/index.js → dist/static/
 * In tests (ts-jest): src/routes/landing.ts → dist/static/
 */
function resolveStaticDir(): string {
  // Prefer dist/static/ (has browser-bundled extension-dapp.js)
  const fromRoot = join(process.cwd(), 'dist', 'static');
  if (existsSync(fromRoot)) return fromRoot;
  const bundled = join(dirname(__dirname), 'static');
  if (existsSync(bundled)) return bundled;
  return fromRoot;
}

const staticDir = resolveStaticDir();

// Cache static files at startup to avoid readFileSync on every request
const faviconBuf = existsSync(join(staticDir, 'favicon.ico')) ? readFileSync(join(staticDir, 'favicon.ico')) : null;
const thumbnailBuf = existsSync(join(staticDir, 'thumbnail.png'))
  ? readFileSync(join(staticDir, 'thumbnail.png'))
  : null;
const extensionDappBuf = existsSync(join(staticDir, 'extension-dapp.js'))
  ? readFileSync(join(staticDir, 'extension-dapp.js'))
  : null;

// Font files (Everett)
const fontDir = join(staticDir, 'fonts');
const fontFiles: Record<string, Buffer | null> = {};
for (const name of ['TWKEverett-Regular-web', 'TWKEverett-Medium-web', 'TWKEverett-Bold-web']) {
  const path = join(fontDir, `${name}.woff2`);
  fontFiles[name] = existsSync(path) ? readFileSync(path) : null;
}

import { serializeForInlineScript, starryBackgroundHtml } from '../util/html';
import { DemoClients } from '../demo';
import { sharedCss, cssLinks } from '../styles';
import { testnetBannerHtml } from '../util/testnet';

const OG_DESCRIPTION = 'Substrate wallet authentication with on-chain scope verification for the Bittensor network.';

function ogMeta(): string {
  const url = config.publicUrl;
  return `<meta name="description" content="${OG_DESCRIPTION}">
  <meta property="og:title" content="Taostats Auth Gateway">
  <meta property="og:description" content="${OG_DESCRIPTION}">
  <meta property="og:image" content="${url}/static/thumbnail.png">
  <meta property="og:url" content="${url}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Taostats Auth Gateway">
  <meta name="twitter:description" content="${OG_DESCRIPTION}">
  <meta name="twitter:image" content="${url}/static/thumbnail.png">`;
}

const taostatsLogo = `<div class="logo"><svg width="180" height="27" viewBox="0 0 915 137" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M23.3719 24.7788C19.7783 18.8243 24.0746 11.2347 31.0389 11.2347H84.4535C87.1748 11.2347 89.7484 12.4705 91.4468 14.5928L119.084 49.1268C123.766 54.9776 119.593 63.637 112.09 63.637H51.8802C48.7418 63.637 45.8326 61.9962 44.2132 59.3128L23.3719 24.7788Z" fill="white"/>
<path d="M19.0749 89.3998C20.6173 86.4484 23.6757 84.5977 27.0107 84.5977H94.932C101.653 84.5977 105.976 91.7159 102.868 97.6639L84.8198 132.198C83.2774 135.149 80.219 137 76.884 137H8.96274C2.24168 137 -2.08159 129.882 1.02693 123.934L19.0749 89.3998Z" fill="white"/>
<path d="M243.85 115.385H255.329V134.079H239.621C219.482 134.079 203.975 124.229 203.975 103.122V44.224H182.628V25.7304H203.975V0H229.149V25.7304H254.926V44.224H229.149V101.916C229.149 112.369 234.586 115.385 243.85 115.385Z" fill="white"/>
<path d="M308.767 23.3181C342.197 23.3181 356.295 42.8169 356.295 64.9289V134.079H331.322V112.57C324.475 126.843 315.211 136.491 294.468 136.491C273.926 136.491 257.412 121.817 257.412 101.313C257.412 76.186 281.781 70.7585 302.322 68.7483L331.121 65.733V63.9238C331.121 51.2597 323.871 41.0077 308.767 41.0077C295.274 41.0077 287.822 49.0485 286.412 58.0943H261.037C263.655 36.7864 282.183 23.3181 308.767 23.3181ZM304.135 120.611C322.058 120.611 331.121 106.138 331.121 88.046V81.6134L311.586 83.6236C297.892 85.2318 282.989 87.242 282.989 101.313C282.989 113.575 292.656 120.611 304.135 120.611Z" fill="white"/>
<path d="M419.86 136.491C386.429 136.491 365.283 113.374 365.283 79.8043C365.283 46.4352 386.429 23.3181 419.86 23.3181C453.492 23.3181 474.638 46.4352 474.638 79.8043C474.638 113.374 453.492 136.491 419.86 136.491ZM419.86 118.802C438.589 118.802 448.86 103.725 448.86 79.8043C448.86 56.0841 438.589 41.0077 419.86 41.0077C401.332 41.0077 390.86 56.0841 390.86 79.8043C390.86 103.725 401.332 118.802 419.86 118.802Z" fill="white"/>
<path d="M525.402 136.491C500.027 136.491 480.492 124.832 477.27 101.916H502.645C505.263 114.982 515.736 118.802 526.006 118.802C541.312 118.802 549.368 113.374 549.368 104.932C549.368 96.6898 544.333 92.6695 528.624 89.4532L511.506 85.6338C491.77 81.4124 479.687 72.3666 479.687 55.8831C479.687 35.9823 499.826 23.3181 524.597 23.3181C547.555 23.3181 566.889 33.369 571.521 53.4709H546.145C543.326 45.4301 534.465 41.0077 524.798 41.0077C513.923 41.0077 504.055 45.6312 504.055 53.8729C504.055 61.3106 510.701 63.9238 523.791 66.7381L540.909 70.3564C563.666 75.1809 573.534 85.2318 573.534 102.519C573.534 124.028 553.194 136.491 525.402 136.491Z" fill="white"/>
<path d="M631.14 115.385H642.619V134.079H626.911C606.772 134.079 591.265 124.229 591.265 103.122V44.224H569.917V25.7304H591.265V0H616.438V25.7304H642.216V44.224H616.438V101.916C616.438 112.369 621.876 115.385 631.14 115.385Z" fill="white"/>
<path d="M696.056 23.3181C729.487 23.3181 743.584 42.8169 743.584 64.9289V134.079H718.612V112.57C711.765 126.843 702.501 136.491 681.758 136.491C661.216 136.491 644.702 121.817 644.702 101.313C644.702 76.186 669.07 70.7585 689.612 68.7483L718.411 65.733V63.9238C718.411 51.2597 711.161 41.0077 696.056 41.0077C682.563 41.0077 675.112 49.0485 673.702 58.0943H648.327C650.945 36.7864 669.473 23.3181 696.056 23.3181ZM691.424 120.611C709.348 120.611 718.411 106.138 718.411 88.046V81.6134L698.876 83.6236C685.181 85.2318 670.279 87.242 670.279 101.313C670.279 113.575 679.945 120.611 691.424 120.611Z" fill="white"/>
<path d="M806.986 115.385H818.465V134.079H802.757C782.618 134.079 767.111 124.229 767.111 103.122V44.224H745.763V25.7304H767.111V0H792.284V25.7304H818.062V44.224H792.284V101.916C792.284 112.369 797.722 115.385 806.986 115.385Z" fill="white"/>
<path d="M866.868 136.491C841.493 136.491 821.958 124.832 818.736 101.916H844.111C846.729 114.982 857.201 118.802 867.472 118.802C882.778 118.802 890.833 113.374 890.833 104.932C890.833 96.6898 885.798 92.6695 870.09 89.4532L852.972 85.6338C833.236 81.4124 821.152 72.3666 821.152 55.8831C821.152 35.9823 841.291 23.3181 866.062 23.3181C889.021 23.3181 908.354 33.369 912.986 53.4709H887.611C884.792 45.4301 875.93 41.0077 866.264 41.0077C855.389 41.0077 845.521 45.6312 845.521 53.8729C845.521 61.3106 852.166 63.9238 865.257 66.7381L882.375 70.3564C905.132 75.1809 915 85.2318 915 102.519C915 124.028 894.66 136.491 866.868 136.491Z" fill="white"/>
</svg></div>`;

let demoClients: DemoClients | null = null;

export function setDemoClients(clients: DemoClients): void {
  demoClients = clients;
}

function endpointLinks(): string {
  return `
    <div class="card">
      <h3>Endpoints</h3>
      <ul class="link-list">
        <li><a class="path" href="/.well-known/openid-configuration">/.well-known/openid-configuration</a><span class="desc">OIDC Discovery</span></li>
        <li><a class="path" href="/.well-known/jwks.json">/.well-known/jwks.json</a><span class="desc">JSON Web Key Set</span></li>
        <li><a class="path" href="/health">/health</a><span class="desc">Health Check</span></li>
      </ul>
    </div>`;
}

function productionPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Taostats Auth Gateway</title>
  ${ogMeta()}
  ${cssLinks}
</head>
<body>
  ${starryBackgroundHtml()}
  ${testnetBannerHtml()}
  ${taostatsLogo}
  <h1>Auth Gateway</h1>
  <p class="subtitle">Substrate wallet authentication with on-chain scope verification for the Bittensor network.</p>

  <div class="card">
    <h3>About</h3>
    <p style="color:var(--text-secondary);font-size:0.95rem;">This gateway provides OAuth2-based authentication using Substrate sr25519 wallet signatures. It verifies on-chain roles (miner, validator, owner, holder) against Subtensor state and issues RS256 JWT access tokens with epoch-aligned expiry. Tokens include resolved <code>hotkey</code> and <code>coldkey</code> claims so downstream services can identify both keys from a single signature.</p>
  </div>

  ${endpointLinks()}

  <div class="card">
    <h3>Auth Flows</h3>
    <ul class="link-list">
      <li><span class="path">Authorization Code + PKCE</span><span class="desc">Web applications</span></li>
      <li><span class="path">Device Code (RFC 8628)</span><span class="desc">CLI tools &amp; headless devices</span></li>
      <li><span class="path">Challenge-Response</span><span class="desc">Direct wallet verification</span></li>
    </ul>
  </div>

  <footer>
    <a href="https://github.com/taostat/auth-gateway">GitHub</a> · v${config.version}
  </footer>
</body>
</html>`;
}

function demoPage(webClientId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Taostats Auth Gateway</title>
  ${ogMeta()}
  ${cssLinks}
</head>
<body>
  ${starryBackgroundHtml()}
  ${testnetBannerHtml()}
  ${taostatsLogo}
  <h1>Auth Gateway <span class="badge demo">Demo</span></h1>
  <p class="subtitle">Substrate wallet authentication with on-chain scope verification for the Bittensor network.</p>

  <div class="card">
    <h3>About</h3>
    <p style="color:var(--text-secondary);font-size:0.95rem;">This gateway provides OAuth2-based authentication using Substrate sr25519 wallet signatures. It verifies on-chain roles (miner, validator, owner, holder) against Subtensor state and issues RS256 JWT access tokens with epoch-aligned expiry. Tokens include resolved <code>hotkey</code> and <code>coldkey</code> claims so downstream services can identify both keys from a single signature.</p>
  </div>

  <div id="status-bar"></div>

  <div class="card" style="margin-top:1rem;">
    <h3>OIDC ID Token</h3>
    <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:12px;">Verify wallet identity via OpenID Connect. Proves you own an address — no on-chain role checks.</p>
    <div style="text-align:right;"><button class="btn btn-primary" onclick="startFlow('openid').catch(showErr)">Verify Identity</button></div>
  </div>

  <div class="card" style="margin-top:1rem;">
    <h3>OAuth2 Authorization Code</h3>
    <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:12px;">PKCE flow with on-chain scope verification. Add one or more scopes to check roles against Subtensor state.</p>
    <div id="scope-rows" style="display:flex;flex-direction:column;gap:8px;"></div>
    <div style="margin-top:10px;">
      <button style="background:none;border:none;color:var(--accent);cursor:pointer;font-family:var(--font);font-size:0.85rem;padding:0;" onclick="addScopeRow()">+ Add scope</button>
    </div>
    <p id="scope-preview" style="color:var(--text-muted);font-size:0.8rem;font-family:var(--font-mono);margin-top:10px;"></p>
    <div style="margin-top:14px;text-align:right;">
      <button class="btn btn-primary" onclick="loginWithScopes().catch(showErr)">Login with Scopes</button>
    </div>
  </div>

  <div class="card" style="margin-top:1rem;">
    <h3>Device Code Flow</h3>
    <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:12px;">For CLI tools and headless devices. Run this in your terminal:</p>
    <pre id="curl-pipe" style="cursor:pointer;" onclick="copyPipe()" title="Click to copy"></pre>
    <p style="color:var(--text-muted);font-size:0.8rem;margin-top:8px;">It will request a device code, open your browser for wallet approval, and print your tokens. Requires <code>curl</code> and <code>jq</code>. Or <a href="/v1/device/verify">open the verify page</a> directly.</p>
  </div>

  ${endpointLinks()}

  <footer>
    <a href="https://github.com/taostat/auth-gateway">GitHub</a> · v${config.version}
  </footer>

  <script data-cfasync="false">
    const CLIENT_ID = ${serializeForInlineScript(webClientId)};
    const ISSUER = ${serializeForInlineScript(config.jwtIssuer)};
    const REDIRECT_URI = window.location.origin + '/';
    const IS_MAINNET = ${!config.isTestnet};

    function showErr(err) { alert(err.message || err); }

    function esc(str) {
      const d = document.createElement('div');
      d.textContent = String(str);
      return d.innerHTML;
    }

    // --- Multi-scope builder ---
    var scopeRowId = 0;
    var TAOSTATS_HOTKEY = '5GKH9FPPnWSUoeeTJp19wVtd84XqFW4pyK2ijV2GsFbhTrP1';

    function addScopeRow(preset) {
      var id = scopeRowId++;
      var container = document.getElementById('scope-rows');
      var row = document.createElement('div');
      row.id = 'scope-row-' + id;
      row.style.cssText = 'display:flex;align-items:center;gap:8px;';
      var type = (preset && preset.type) || 'subnet';
      row.innerHTML =
        '<select class="scope-type" style="flex-shrink:0;" onchange="onScopeTypeChange(' + id + ')">' +
        '<option value="subnet"' + (type === 'subnet' ? ' selected' : '') + '>Subnet</option>' +
        '<option value="tao"' + (type === 'tao' ? ' selected' : '') + '>TAO Holder</option>' +
        (IS_MAINNET ? '<option value="delegate"' + (type === 'delegate' ? ' selected' : '') + '>Delegated to Validator</option>' : '') +
        (IS_MAINNET ? '<option value="staker"' + (type === 'staker' ? ' selected' : '') + '>Staker</option>' : '') +
        '</select>' +
        '<span class="scope-params" id="scope-params-' + id + '" style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;"></span>' +
        '<button style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1rem;padding:2px 6px;line-height:1;flex-shrink:0;" onclick="removeScopeRow(' + id + ')">&times;</button>';
      container.appendChild(row);
      renderScopeParams(id, type, preset);
      updateScopePreview();
    }

    function renderScopeParams(id, type, preset) {
      var el = document.getElementById('scope-params-' + id);
      if (type === 'subnet') {
        var role = (preset && preset.role) || 'validator';
        var netuid = (preset && preset.netuid) || '19';
        var min = (preset && preset.min) || '';
        el.innerHTML =
          '<input type="number" min="0" max="65535" value="' + esc(netuid) + '" style="width:56px;flex-shrink:0;" class="scope-netuid" data-row="' + id + '" oninput="updateScopePreview()">' +
          '<select class="scope-role" data-row="' + id + '" style="flex:1;" onchange="onSubnetRoleChange(' + id + ');updateScopePreview()">' +
          '<option value="validator"' + (role === 'validator' ? ' selected' : '') + '>validator</option>' +
          '<option value="miner"' + (role === 'miner' ? ' selected' : '') + '>miner</option>' +
          '<option value="owner"' + (role === 'owner' ? ' selected' : '') + '>owner</option>' +
          '<option value="holder"' + (role === 'holder' ? ' selected' : '') + '>holder</option>' +
          '</select>' +
          '<span id="scope-min-' + id + '" style="display:' + (role === 'holder' ? 'contents' : 'none') + ';">' +
          '<input type="number" min="0" step="any" value="' + esc(min) + '" placeholder="min alpha" style="width:80px;flex-shrink:0;" class="scope-min" data-row="' + id + '" oninput="updateScopePreview()">' +
          '</span>';
      } else if (type === 'tao') {
        var min = (preset && preset.min) || '';
        el.innerHTML =
          '<input type="number" min="0" step="any" value="' + esc(min) + '" placeholder="min TAO" style="width:80px;flex-shrink:0;" class="scope-tao-min" data-row="' + id + '" oninput="updateScopePreview()">';
      } else if (type === 'delegate') {
        var hotkey = (preset && preset.hotkey) || TAOSTATS_HOTKEY;
        var min = (preset && preset.min) || '';
        el.innerHTML =
          '<select class="scope-hotkey" data-row="' + id + '" onchange="updateScopePreview()" style="flex:1;min-width:0;">' +
          '<option value="' + TAOSTATS_HOTKEY + '"' + (hotkey === TAOSTATS_HOTKEY ? ' selected' : '') + '>Taostats</option>' +
          '<option value="5G3wMP3g3d775hauwmAZioYFVZYnvw6eY46wkFy8hEWD5KP3"' + (hotkey === '5G3wMP3g3d775hauwmAZioYFVZYnvw6eY46wkFy8hEWD5KP3' ? ' selected' : '') + '>Opentensor Foundation</option>' +
          '<option value="5DXdHixxtCvoa6GHKs2Jgrdzc61882Ftx1zN2sYFQuwgL1S1"' + (hotkey === '5DXdHixxtCvoa6GHKs2Jgrdzc61882Ftx1zN2sYFQuwgL1S1' ? ' selected' : '') + '>Yuma (DCG)</option>' +
          '</select>' +
          '<input type="number" min="0" step="any" value="' + esc(min) + '" placeholder="min TAO" style="width:80px;flex-shrink:0;" class="scope-delegate-min" data-row="' + id + '" oninput="updateScopePreview()">';
      } else if (type === 'staker') {
        var min = (preset && preset.min) || '100';
        el.innerHTML =
          '<input type="number" min="0" step="any" value="' + esc(min) + '" placeholder="min TAO" style="width:90px;" class="scope-staker-min" data-row="' + id + '" oninput="updateScopePreview()">';
      }
    }

    function onScopeTypeChange(id) {
      var row = document.getElementById('scope-row-' + id);
      var type = row.querySelector('.scope-type').value;
      renderScopeParams(id, type);
      updateScopePreview();
    }

    function onSubnetRoleChange(id) {
      var row = document.getElementById('scope-row-' + id);
      var role = row.querySelector('.scope-role').value;
      var minWrap = document.getElementById('scope-min-' + id);
      if (minWrap) minWrap.style.display = role === 'holder' ? 'contents' : 'none';
    }

    function removeScopeRow(id) {
      var row = document.getElementById('scope-row-' + id);
      if (row) row.remove();
      updateScopePreview();
    }

    function getScopeFromRow(row) {
      var type = row.querySelector('.scope-type').value;
      if (type === 'subnet') {
        var netuid = row.querySelector('.scope-netuid').value || '0';
        var role = row.querySelector('.scope-role').value;
        var scope = 'subnet:' + netuid + ':' + role;
        if (role === 'holder') {
          var min = row.querySelector('.scope-min');
          if (min && min.value) scope += ':' + min.value;
        }
        return scope;
      }
      if (type === 'tao') {
        var min = row.querySelector('.scope-tao-min');
        return min && min.value ? 'tao:holder:' + min.value : 'tao:holder';
      }
      if (type === 'delegate') {
        var hotkey = row.querySelector('.scope-hotkey').value || '';
        var min = row.querySelector('.scope-delegate-min');
        var scope = 'delegate:' + hotkey;
        if (min && min.value) scope += ':' + min.value;
        return scope;
      }
      if (type === 'staker') {
        var min = row.querySelector('.scope-staker-min');
        return 'staker:' + (min && min.value ? min.value : '100');
      }
      return '';
    }

    function getScopes() {
      var rows = document.querySelectorAll('[id^="scope-row-"]');
      var scopes = [];
      for (var i = 0; i < rows.length; i++) {
        var s = getScopeFromRow(rows[i]);
        if (s) scopes.push(s);
      }
      return scopes;
    }

    function updateScopePreview() {
      var scopes = getScopes();
      var el = document.getElementById('scope-preview');
      el.textContent = scopes.length ? scopes.join(' ') : '';
    }

    function loginWithScopes() {
      var scopes = getScopes();
      if (scopes.length === 0) return startFlow('');
      return startFlow(scopes.join(' '));
    }

    // Start with one scope row
    addScopeRow({ type: 'subnet', role: 'holder', netuid: '19' });

    // --- Device code pipe command ---
    const PIPE_CMD = 'curl -s ' + window.location.origin + '/v1/device/demo.sh | bash';
    (function() {
      const el = document.getElementById('curl-pipe');
      if (el) el.textContent = PIPE_CMD;
    })();
    function copyPipe() {
      navigator.clipboard.writeText(PIPE_CMD).then(function() {
        const el = document.getElementById('curl-pipe');
        const orig = el.textContent;
        el.textContent = 'Copied!';
        setTimeout(function() { el.textContent = orig; }, 1500);
      });
    }

    // --- PKCE helpers ---
    function generateVerifier() {
      const arr = new Uint8Array(32);
      crypto.getRandomValues(arr);
      return btoa(String.fromCharCode(...arr)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
    }
    function generateNonce() {
      const arr = new Uint8Array(16);
      crypto.getRandomValues(arr);
      return btoa(String.fromCharCode(...arr)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
    }
    async function sha256(plain) {
      if (!crypto.subtle) {
        throw new Error('crypto.subtle is not available. The page must be served over HTTPS (or localhost).');
      }
      const data = new TextEncoder().encode(plain);
      const hash = await crypto.subtle.digest('SHA-256', data);
      return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
    }

    async function startFlow(scope) {
      const verifier = generateVerifier();
      const challenge = await sha256(verifier);
      sessionStorage.setItem('pkce_verifier', verifier);
      var wantsOidc = Boolean(scope) && scope.split(' ').indexOf('openid') !== -1;
      if (wantsOidc) {
        const nonce = generateNonce();
        sessionStorage.setItem('oidc_nonce', nonce);
      } else {
        sessionStorage.removeItem('oidc_nonce');
      }
      let url = '/v1/oauth/authorize?client_id=' + encodeURIComponent(CLIENT_ID)
        + '&redirect_uri=' + encodeURIComponent(REDIRECT_URI)
        + '&response_type=code&state=demo'
        + '&code_challenge=' + challenge
        + '&code_challenge_method=S256';
      if (wantsOidc) url += '&nonce=' + encodeURIComponent(sessionStorage.getItem('oidc_nonce') || '');
      if (scope) url += '&scope=' + encodeURIComponent(scope);
      window.location.href = url;
    }

    // --- Callback handler ---
    async function handleCallback() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const error = params.get('error');
      const bar = document.getElementById('status-bar');

      if (error) {
        bar.innerHTML = '<div class="status error">Authorization error: ' + esc(error) + '</div>';
        window.history.replaceState({}, '', '/');
        return;
      }

      if (!code) return;

      bar.innerHTML = '<div class="status loading">Exchanging code for tokens...</div>';

      try {
        const tokenBody = {
          grant_type: 'authorization_code',
          code: code,
          client_id: CLIENT_ID,
          redirect_uri: REDIRECT_URI,
        };
        const verifier = sessionStorage.getItem('pkce_verifier');
        if (verifier) {
          tokenBody.code_verifier = verifier;
          sessionStorage.removeItem('pkce_verifier');
        }
        const res = await fetch('/v1/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tokenBody),
        });

        const data = await res.json();

        if (!res.ok) {
          bar.innerHTML = '<div class="status error">Token exchange failed: ' + esc(data.message || res.status) + '</div>';
          window.history.replaceState({}, '', '/');
          return;
        }

        if (data.id_token) {
          var expectedNonce = sessionStorage.getItem('oidc_nonce');
          sessionStorage.removeItem('oidc_nonce');
          var idClaims = decodeJwtPayload(data.id_token);
          if (!idClaims) {
            bar.innerHTML = '<div class="status error">Failed to decode ID token</div>';
            window.history.replaceState({}, '', '/');
            return;
          }
          // OIDC baseline checks: iss, aud, exp, nonce
          if (idClaims.iss !== ISSUER) {
            bar.innerHTML = '<div class="status error">ID token issuer mismatch: expected ' + esc(ISSUER) + ', got ' + esc(idClaims.iss) + '</div>';
            window.history.replaceState({}, '', '/');
            return;
          }
          if (idClaims.aud !== CLIENT_ID) {
            bar.innerHTML = '<div class="status error">ID token audience mismatch: expected ' + esc(CLIENT_ID) + ', got ' + esc(idClaims.aud) + '</div>';
            window.history.replaceState({}, '', '/');
            return;
          }
          if (!idClaims.exp || idClaims.exp < Math.floor(Date.now() / 1000)) {
            bar.innerHTML = '<div class="status error">ID token is expired</div>';
            window.history.replaceState({}, '', '/');
            return;
          }
          if (!expectedNonce) {
            bar.innerHTML = '<div class="status error">Missing stored nonce for ID token validation</div>';
            window.history.replaceState({}, '', '/');
            return;
          }
          if (idClaims.nonce !== expectedNonce) {
            bar.innerHTML = '<div class="status error">ID token nonce mismatch</div>';
            window.history.replaceState({}, '', '/');
            return;
          }
        }

        window.history.replaceState({}, '', '/');
        showTokenModal(data);
      } catch (err) {
        bar.innerHTML = '<div class="status error">Network error: ' + esc(err.message) + '</div>';
        window.history.replaceState({}, '', '/');
      }
    }

    function decodeJwtPayload(token) {
      var parts = token.split('.');
      if (parts.length < 2) return null;
      var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return JSON.parse(atob(b64));
    }

    function showTokenModal(data) {
      var bar = document.getElementById('status-bar');
      bar.innerHTML = '';
      var primaryToken = data.id_token || data.access_token;
      var claims = decodeJwtPayload(primaryToken);
      if (!claims) { bar.innerHTML = '<div class="status error">Failed to decode token</div>'; return; }

      var overlay = document.createElement('div');
      overlay.id = 'token-modal-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;';
      overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

      var modal = document.createElement('div');
      modal.style.cssText = 'background:#1e1e1e;border:1px solid #262626;border-radius:16px;padding:28px;max-width:520px;width:100%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.5);position:relative;z-index:101;';

      var h = document.createElement('h2');
      h.textContent = data.id_token ? 'Identity Verified' : 'Authorization Successful';
      h.style.cssText = 'font-size:1.1rem;font-weight:500;margin-bottom:16px;color:#fafafa;';
      modal.appendChild(h);

      var fields = [
        ['Token Type', data.id_token ? 'OIDC ID Token' : 'Access Token'],
        ['Address', claims.sub],
        ['Hotkey', claims.hotkey],
        ['Coldkey', claims.coldkey],
        ['Scopes', claims.scope || 'none'],
        ['Issuer', claims.iss],
        ['Audience', claims.aud],
        ['Expires', claims.exp ? new Date(claims.exp * 1000).toLocaleString() : '—'],
      ];

      if (claims.auth_time) {
        fields.push(['Auth Time', new Date(claims.auth_time * 1000).toLocaleString()]);
      }

      fields.forEach(function(f) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #262626;font-size:0.9rem;gap:12px;';
        var label = document.createElement('span');
        label.textContent = f[0];
        label.style.cssText = 'color:#a5a5a5;flex-shrink:0;';
        var val = document.createElement('span');
        val.textContent = f[1] || '—';
        val.style.cssText = 'color:#fafafa;font-family:var(--font-mono);font-size:0.8rem;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        row.appendChild(label);
        row.appendChild(val);
        modal.appendChild(row);
      });

      var btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:10px;margin-top:20px;justify-content:flex-end;';

      var closeBtn = document.createElement('button');
      closeBtn.textContent = 'Close';
      closeBtn.className = 'btn btn-secondary';
      closeBtn.onclick = function() { overlay.remove(); };

      var jwtBtn = document.createElement('a');
      jwtBtn.textContent = 'View on jwt.io';
      jwtBtn.className = 'btn btn-primary';
      jwtBtn.href = 'https://jwt.io/#debugger-io?token=' + encodeURIComponent(primaryToken);
      jwtBtn.target = '_blank';

      btnRow.appendChild(closeBtn);
      btnRow.appendChild(jwtBtn);
      modal.appendChild(btnRow);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
    }

    handleCallback();
  </script>
</body>
</html>`;
}

function deviceDemoScript(gatewayUrl: string, clientId: string): string {
  const gw = gatewayUrl.replace(/\/$/, '');
  return `#!/bin/bash
# Taostats Auth Gateway — Device Code Flow Demo
# Requires: curl, jq
set -e

GW="${gw}"
CLIENT_ID="${clientId}"

# 1. Request device code
RESP=$(curl -s -X POST "$GW/v1/device/code" \\
  -H "Content-Type: application/json" \\
  -d "{\\"client_id\\":\\"$CLIENT_ID\\"}")

DEVICE_CODE=$(echo "$RESP" | jq -r .device_code)
USER_CODE=$(echo "$RESP" | jq -r .user_code)
VERIFY_URI=$(echo "$RESP" | jq -r .verification_uri)
INTERVAL=$(echo "$RESP" | jq -r .interval)

echo ""
echo "  User code:  $USER_CODE"
echo "  Open:       $VERIFY_URI?user_code=$USER_CODE"
echo ""
echo "Waiting for approval..."

# 2. Open browser (best-effort)
(open "$VERIFY_URI?user_code=$USER_CODE" 2>/dev/null || xdg-open "$VERIFY_URI?user_code=$USER_CODE" 2>/dev/null || true) &

# 3. Poll for token
while true; do
  sleep "$INTERVAL"
  TOKEN_RESP=$(curl -s -X POST "$GW/v1/oauth/token" \\
    -H "Content-Type: application/json" \\
    -d "{\\"client_id\\":\\"$CLIENT_ID\\",\\"device_code\\":\\"$DEVICE_CODE\\",\\"grant_type\\":\\"urn:ietf:params:oauth:grant-type:device_code\\"}")

  ERROR=$(echo "$TOKEN_RESP" | jq -r ".error // empty")
  if [ -z "$ERROR" ]; then
    echo ""
    echo "Access token:"
    echo "$TOKEN_RESP" | jq -r .access_token
    echo ""
    echo "Refresh token:"
    echo "$TOKEN_RESP" | jq -r .refresh_token
    echo ""
    echo "Claims:"
    echo "$TOKEN_RESP" | jq -r .access_token | cut -d. -f2 | tr '_-' '/+' | awk '{while(length%4)$0=$0"=";print}' | base64 --decode 2>/dev/null | jq .
    exit 0
  fi
  if [ "$ERROR" != "authorization_pending" ] && [ "$ERROR" != "slow_down" ]; then
    echo "Error: $ERROR"
    exit 1
  fi
  printf "."
done
`;
}

/** CSP for landing pages (no polkadot extension needed) */
const LANDING_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

export async function landingRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /static/styles.css — shared stylesheet
  fastify.get('/static/styles.css', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply
      .header('Content-Type', 'text/css')
      .header('Cache-Control', 'public, max-age=3600')
      .code(200)
      .send(sharedCss);
  });

  // GET /favicon.ico
  fastify.get('/favicon.ico', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!faviconBuf) return reply.code(404).send();
    return reply
      .header('Content-Type', 'image/x-icon')
      .header('Cache-Control', 'public, max-age=86400')
      .code(200)
      .send(faviconBuf);
  });

  // GET /static/thumbnail.png — OG share image
  fastify.get('/static/thumbnail.png', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!thumbnailBuf) return reply.code(404).send();
    return reply
      .header('Content-Type', 'image/png')
      .header('Cache-Control', 'public, max-age=86400')
      .code(200)
      .send(thumbnailBuf);
  });

  // GET /static/extension-dapp.js — self-hosted Polkadot wallet extension library
  fastify.get('/static/extension-dapp.js', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!extensionDappBuf) return reply.code(404).send();
    return reply
      .header('Content-Type', 'application/javascript')
      .header('Cache-Control', 'public, max-age=86400')
      .code(200)
      .send(extensionDappBuf);
  });

  // GET /static/fonts/:file — self-hosted Everett font files
  fastify.get(
    '/static/fonts/:file',
    async (
      request: FastifyRequest<{
        Params: { file: string };
      }>,
      reply: FastifyReply,
    ) => {
      const name = request.params.file.replace(/\.woff2$/, '');
      const buf = fontFiles[name];
      if (!buf) return reply.code(404).send();
      return reply
        .header('Content-Type', 'font/woff2')
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .code(200)
        .send(buf);
    },
  );

  fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    const html = config.demoMode && demoClients ? demoPage(demoClients.webClientId) : productionPage();

    return reply
      .header('Content-Type', 'text/html')
      .header('Content-Security-Policy', LANDING_CSP)
      .header('X-Frame-Options', 'DENY')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .code(200)
      .send(html);
  });

  // GET /v1/device/demo.sh — downloadable bash script for device code flow
  fastify.get('/v1/device/demo.sh', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!config.demoMode || !demoClients) {
      return reply.code(404).send({ error: 'Not available outside demo mode' });
    }

    const script = deviceDemoScript(config.publicUrl, demoClients.cliClientId);
    return reply
      .header('Content-Type', 'text/plain')
      .header('Content-Disposition', 'inline; filename="demo.sh"')
      .code(200)
      .send(script);
  });
}
