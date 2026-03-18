import { config } from '../config';

/**
 * Starry background — faithful vanilla JS port of the wallet
 * extension's StarryBackground.tsx (Framer Motion → Web Animations API).
 */
export function starryBackgroundHtml(nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  return `<div class="starry-bg" id="starry-bg"></div>
<script data-cfasync="false"${nonceAttr}>
(function(){
  var container = document.getElementById('starry-bg');
  if (!container) return;

  var COLORS = ['#00DBBC','#EB5347','#ffffff'];
  var LAYER_OPACITY = [0, 0.6, 0.8, 1.0];
  var DENSITY = 0.0005;

  function pickColor() {
    var r = Math.random();
    return r < 0.08 ? COLORS[1] : r < 0.16 ? COLORS[0] : COLORS[2];
  }

  function generateStars() {
    container.innerHTML = '';
    var w = window.innerWidth || 800;
    var h = window.innerHeight || 600;
    var count = Math.max(20, Math.min(80, Math.round(w * h * DENSITY)));

    for (var i = 0; i < count; i++) {
      var el = document.createElement('div');
      var layer = Math.floor(Math.random() * 3) + 1;
      var size = Math.random() * 6 + 1;
      var col = pickColor();
      var shape = Math.random() < 0.5 ? '50%' : '0';
      var op = LAYER_OPACITY[layer];

      el.style.cssText =
        'position:absolute;opacity:' + (op * 0.3).toFixed(2) +
        ';left:' + (Math.random()*100).toFixed(1) +
        '%;top:' + (Math.random()*100).toFixed(1) +
        '%;width:' + size.toFixed(1) + 'px;height:' + size.toFixed(1) +
        'px;background:' + col + ';border-radius:' + shape +
        ';will-change:opacity,transform';

      container.appendChild(el);

      el.animate([
        { opacity: op * 0.3, transform: 'scale(1)' },
        { opacity: op,       transform: 'scale(1.2)' },
        { opacity: op * 0.3, transform: 'scale(1)' }
      ], {
        duration: (6 + Math.random() * 3) * 1000,
        iterations: Infinity,
        delay: Math.random() * 2000,
        easing: 'ease-in-out'
      });
    }
  }

  function createShootingStar() {
    var col = pickColor();
    var shape = Math.random() < 0.5 ? '50%' : '0';
    var startX = Math.random() * 100;
    var startY = Math.random() * 50;
    var dx = (Math.random() * 40 + 20) * (Math.random() > 0.5 ? 1 : -1);
    var dy = Math.random() * 30 + 20;
    var dur = (Math.random() * 1.1 + 1) * 1000;

    var wrapper = document.createElement('div');
    wrapper.style.cssText =
      'position:absolute;left:' + startX.toFixed(1) +
      '%;top:' + startY.toFixed(1) + '%;width:2px;height:2px';

    var dot = document.createElement('div');
    dot.style.cssText =
      'width:3px;height:3px;background:' + col +
      ';border-radius:' + shape;
    wrapper.appendChild(dot);
    container.appendChild(wrapper);

    var anim = wrapper.animate([
      { transform: 'translate(0,0)', opacity: 0, offset: 0 },
      { transform: 'translate(0,0)', opacity: 1, offset: 0.1 },
      { transform: 'translate('+dx+'vw,'+dy+'vh)', opacity: 1, offset: 0.9 },
      { transform: 'translate('+dx+'vw,'+dy+'vh)', opacity: 0, offset: 1 }
    ], {
      duration: dur,
      easing: 'ease-out',
      fill: 'forwards'
    });

    anim.onfinish = function() { wrapper.remove(); };
  }

  generateStars();
  window.addEventListener('resize', generateStars);

  setInterval(function() {
    if (Math.random() < 0.6) createShootingStar();
  }, 5000);
})();
<\u002fscript>`;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Safely serialize a value for inline <script> contexts.
 * Prevents sequence breaks like </script> and handles line separators.
 */
export function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Taostats logo (icon + wordmark) for auth page headers — always white */
export const authHeaderHtml = `<div class="auth-header">
  <svg width="140" height="21" viewBox="0 0 915 137" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M23.3719 24.7788C19.7783 18.8243 24.0746 11.2347 31.0389 11.2347H84.4535C87.1748 11.2347 89.7484 12.4705 91.4468 14.5928L119.084 49.1268C123.766 54.9776 119.593 63.637 112.09 63.637H51.8802C48.7418 63.637 45.8326 61.9962 44.2132 59.3128L23.3719 24.7788Z"/><path d="M19.0749 89.3998C20.6173 86.4484 23.6757 84.5977 27.0107 84.5977H94.932C101.653 84.5977 105.976 91.7159 102.868 97.6639L84.8198 132.198C83.2774 135.149 80.219 137 76.884 137H8.96274C2.24168 137 -2.08159 129.882 1.02693 123.934L19.0749 89.3998Z"/><path d="M243.85 115.385H255.329V134.079H239.621C219.482 134.079 203.975 124.229 203.975 103.122V44.224H182.628V25.7304H203.975V0H229.149V25.7304H254.926V44.224H229.149V101.916C229.149 112.369 234.586 115.385 243.85 115.385Z"/><path d="M308.767 23.3181C342.197 23.3181 356.295 42.8169 356.295 64.9289V134.079H331.322V112.57C324.475 126.843 315.211 136.491 294.468 136.491C273.926 136.491 257.412 121.817 257.412 101.313C257.412 76.186 281.781 70.7585 302.322 68.7483L331.121 65.733V63.9238C331.121 51.2597 323.871 41.0077 308.767 41.0077C295.274 41.0077 287.822 49.0485 286.412 58.0943H261.037C263.655 36.7864 282.183 23.3181 308.767 23.3181ZM304.135 120.611C322.058 120.611 331.121 106.138 331.121 88.046V81.6134L311.586 83.6236C297.892 85.2318 282.989 87.242 282.989 101.313C282.989 113.575 292.656 120.611 304.135 120.611Z"/><path d="M419.86 136.491C386.429 136.491 365.283 113.374 365.283 79.8043C365.283 46.4352 386.429 23.3181 419.86 23.3181C453.492 23.3181 474.638 46.4352 474.638 79.8043C474.638 113.374 453.492 136.491 419.86 136.491ZM419.86 118.802C438.589 118.802 448.86 103.725 448.86 79.8043C448.86 56.0841 438.589 41.0077 419.86 41.0077C401.332 41.0077 390.86 56.0841 390.86 79.8043C390.86 103.725 401.332 118.802 419.86 118.802Z"/><path d="M525.402 136.491C500.027 136.491 480.492 124.832 477.27 101.916H502.645C505.263 114.982 515.736 118.802 526.006 118.802C541.312 118.802 549.368 113.374 549.368 104.932C549.368 96.6898 544.333 92.6695 528.624 89.4532L511.506 85.6338C491.77 81.4124 479.687 72.3666 479.687 55.8831C479.687 35.9823 499.826 23.3181 524.597 23.3181C547.555 23.3181 566.889 33.369 571.521 53.4709H546.145C543.326 45.4301 534.465 41.0077 524.798 41.0077C513.923 41.0077 504.055 45.6312 504.055 53.8729C504.055 61.3106 510.701 63.9238 523.791 66.7381L540.909 70.3564C563.666 75.1809 573.534 85.2318 573.534 102.519C573.534 124.028 553.194 136.491 525.402 136.491Z"/><path d="M631.14 115.385H642.619V134.079H626.911C606.772 134.079 591.265 124.229 591.265 103.122V44.224H569.917V25.7304H591.265V0H616.438V25.7304H642.216V44.224H616.438V101.916C616.438 112.369 621.876 115.385 631.14 115.385Z"/><path d="M696.056 23.3181C729.487 23.3181 743.584 42.8169 743.584 64.9289V134.079H718.612V112.57C711.765 126.843 702.501 136.491 681.758 136.491C661.216 136.491 644.702 121.817 644.702 101.313C644.702 76.186 669.07 70.7585 689.612 68.7483L718.411 65.733V63.9238C718.411 51.2597 711.161 41.0077 696.056 41.0077C682.563 41.0077 675.112 49.0485 673.702 58.0943H648.327C650.945 36.7864 669.473 23.3181 696.056 23.3181ZM691.424 120.611C709.348 120.611 718.411 106.138 718.411 88.046V81.6134L698.876 83.6236C685.181 85.2318 670.279 87.242 670.279 101.313C670.279 113.575 679.945 120.611 691.424 120.611Z"/><path d="M806.986 115.385H818.465V134.079H802.757C782.618 134.079 767.111 124.229 767.111 103.122V44.224H745.763V25.7304H767.111V0H792.284V25.7304H818.062V44.224H792.284V101.916C792.284 112.369 797.722 115.385 806.986 115.385Z"/><path d="M866.868 136.491C841.493 136.491 821.958 124.832 818.736 101.916H844.111C846.729 114.982 857.201 118.802 867.472 118.802C882.778 118.802 890.833 113.374 890.833 104.932C890.833 96.6898 885.798 92.6695 870.09 89.4532L852.972 85.6338C833.236 81.4124 821.152 72.3666 821.152 55.8831C821.152 35.9823 841.291 23.3181 866.062 23.3181C889.021 23.3181 908.354 33.369 912.986 53.4709H887.611C884.792 45.4301 875.93 41.0077 866.264 41.0077C855.389 41.0077 845.521 45.6312 845.521 53.8729C845.521 61.3106 852.166 63.9238 865.257 66.7381L882.375 70.3564C905.132 75.1809 915 85.2318 915 102.519C915 124.028 894.66 136.491 866.868 136.491Z"/></svg>
</div>`;

/** Small "powered by taostats" footer SVG — always white */
export const poweredByHtml = `<div class="powered-by">
  <span>Powered by</span>
  <a href="https://taostats.io" target="_blank" rel="noopener noreferrer">
    <svg width="70" height="10" viewBox="0 0 915 137" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M23.3719 24.7788C19.7783 18.8243 24.0746 11.2347 31.0389 11.2347H84.4535C87.1748 11.2347 89.7484 12.4705 91.4468 14.5928L119.084 49.1268C123.766 54.9776 119.593 63.637 112.09 63.637H51.8802C48.7418 63.637 45.8326 61.9962 44.2132 59.3128L23.3719 24.7788Z"/><path d="M19.0749 89.3998C20.6173 86.4484 23.6757 84.5977 27.0107 84.5977H94.932C101.653 84.5977 105.976 91.7159 102.868 97.6639L84.8198 132.198C83.2774 135.149 80.219 137 76.884 137H8.96274C2.24168 137 -2.08159 129.882 1.02693 123.934L19.0749 89.3998Z"/><path d="M243.85 115.385H255.329V134.079H239.621C219.482 134.079 203.975 124.229 203.975 103.122V44.224H182.628V25.7304H203.975V0H229.149V25.7304H254.926V44.224H229.149V101.916C229.149 112.369 234.586 115.385 243.85 115.385Z"/><path d="M308.767 23.3181C342.197 23.3181 356.295 42.8169 356.295 64.9289V134.079H331.322V112.57C324.475 126.843 315.211 136.491 294.468 136.491C273.926 136.491 257.412 121.817 257.412 101.313C257.412 76.186 281.781 70.7585 302.322 68.7483L331.121 65.733V63.9238C331.121 51.2597 323.871 41.0077 308.767 41.0077C295.274 41.0077 287.822 49.0485 286.412 58.0943H261.037C263.655 36.7864 282.183 23.3181 308.767 23.3181ZM304.135 120.611C322.058 120.611 331.121 106.138 331.121 88.046V81.6134L311.586 83.6236C297.892 85.2318 282.989 87.242 282.989 101.313C282.989 113.575 292.656 120.611 304.135 120.611Z"/><path d="M419.86 136.491C386.429 136.491 365.283 113.374 365.283 79.8043C365.283 46.4352 386.429 23.3181 419.86 23.3181C453.492 23.3181 474.638 46.4352 474.638 79.8043C474.638 113.374 453.492 136.491 419.86 136.491ZM419.86 118.802C438.589 118.802 448.86 103.725 448.86 79.8043C448.86 56.0841 438.589 41.0077 419.86 41.0077C401.332 41.0077 390.86 56.0841 390.86 79.8043C390.86 103.725 401.332 118.802 419.86 118.802Z"/><path d="M525.402 136.491C500.027 136.491 480.492 124.832 477.27 101.916H502.645C505.263 114.982 515.736 118.802 526.006 118.802C541.312 118.802 549.368 113.374 549.368 104.932C549.368 96.6898 544.333 92.6695 528.624 89.4532L511.506 85.6338C491.77 81.4124 479.687 72.3666 479.687 55.8831C479.687 35.9823 499.826 23.3181 524.597 23.3181C547.555 23.3181 566.889 33.369 571.521 53.4709H546.145C543.326 45.4301 534.465 41.0077 524.798 41.0077C513.923 41.0077 504.055 45.6312 504.055 53.8729C504.055 61.3106 510.701 63.9238 523.791 66.7381L540.909 70.3564C563.666 75.1809 573.534 85.2318 573.534 102.519C573.534 124.028 553.194 136.491 525.402 136.491Z"/><path d="M631.14 115.385H642.619V134.079H626.911C606.772 134.079 591.265 124.229 591.265 103.122V44.224H569.917V25.7304H591.265V0H616.438V25.7304H642.216V44.224H616.438V101.916C616.438 112.369 621.876 115.385 631.14 115.385Z"/><path d="M696.056 23.3181C729.487 23.3181 743.584 42.8169 743.584 64.9289V134.079H718.612V112.57C711.765 126.843 702.501 136.491 681.758 136.491C661.216 136.491 644.702 121.817 644.702 101.313C644.702 76.186 669.07 70.7585 689.612 68.7483L718.411 65.733V63.9238C718.411 51.2597 711.161 41.0077 696.056 41.0077C682.563 41.0077 675.112 49.0485 673.702 58.0943H648.327C650.945 36.7864 669.473 23.3181 696.056 23.3181ZM691.424 120.611C709.348 120.611 718.411 106.138 718.411 88.046V81.6134L698.876 83.6236C685.181 85.2318 670.279 87.242 670.279 101.313C670.279 113.575 679.945 120.611 691.424 120.611Z"/><path d="M806.986 115.385H818.465V134.079H802.757C782.618 134.079 767.111 124.229 767.111 103.122V44.224H745.763V25.7304H767.111V0H792.284V25.7304H818.062V44.224H792.284V101.916C792.284 112.369 797.722 115.385 806.986 115.385Z"/><path d="M866.868 136.491C841.493 136.491 821.958 124.832 818.736 101.916H844.111C846.729 114.982 857.201 118.802 867.472 118.802C882.778 118.802 890.833 113.374 890.833 104.932C890.833 96.6898 885.798 92.6695 870.09 89.4532L852.972 85.6338C833.236 81.4124 821.152 72.3666 821.152 55.8831C821.152 35.9823 841.291 23.3181 866.062 23.3181C889.021 23.3181 908.354 33.369 912.986 53.4709H887.611C884.792 45.4301 875.93 41.0077 866.264 41.0077C855.389 41.0077 845.521 45.6312 845.521 53.8729C845.521 61.3106 852.166 63.9238 865.257 66.7381L882.375 70.3564C905.132 75.1809 915 85.2318 915 102.519C915 124.028 894.66 136.491 866.868 136.491Z"/></svg>
  </a>
</div>`;

export function walletBannerHtml(): string {
  if (!config.walletBannerUrl) return '';
  return `
  <div id="wallet-banner" class="wallet-banner" style="display:none">
    <span>For the best experience, install the <a href="${escapeHtml(config.walletBannerUrl)}" target="_blank" rel="noopener noreferrer">Taostats Wallet</a></span>
    <button id="banner-close">&times;</button>
  </div>
  <div id="mobile-notice" class="wallet-banner" style="display:none">
    <span>Wallet signing is not available on mobile. Please open this page on a desktop browser.</span>
  </div>`;
}

export function mobileDetectScript(): string {
  return `function isMobileDevice() {
      return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
    }`;
}

export function checkWalletScript(): string {
  if (!config.walletBannerUrl) return '';
  return `function checkWallet() {
      var banner = document.getElementById('wallet-banner');
      var mobileNotice = document.getElementById('mobile-notice');
      var btn = document.getElementById('btn-authorize');
      var cliLink = document.getElementById('link-show-cli');

      if (isMobileDevice()) {
        if (banner) banner.style.display = 'none';
        if (mobileNotice) mobileNotice.style.display = 'flex';
        if (cliLink) cliLink.style.display = 'none';
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Desktop required';
          btn.title = 'Wallet signing requires a desktop browser';
        }
        return;
      }

      if (!banner) return;
      if (!window.injectedWeb3 || Object.keys(window.injectedWeb3).length === 0) {
        banner.style.display = 'flex';
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'No wallet detected';
          btn.title = 'Install the Taostats Wallet extension to continue';
        }
      } else {
        banner.style.display = 'none';
        if (btn) {
          btn.disabled = false;
        }
      }
    }
    setTimeout(checkWallet, 500);
    setTimeout(checkWallet, 2000);`;
}

export function ethereumBannerHtml(): string {
  return `
  <div id="eth-banner" class="wallet-banner" style="display:none">
    <span id="eth-banner-text">An Ethereum wallet is required. <a href="https://ethereum.org/en/wallets/find-wallet/" target="_blank" rel="noopener noreferrer">Find a wallet</a></span>
    <button id="banner-close">&times;</button>
  </div>
  <div id="eth-mobile-notice" class="wallet-banner" style="display:none">
    <span>Open this page in your Ethereum wallet's in-app browser to sign.
    <button id="btn-copy-url" style="background:none;border:1px solid var(--text-muted);color:var(--text-secondary);border-radius:4px;padding:2px 8px;cursor:pointer;font-size:0.8rem;margin-left:6px;">Copy URL</button></span>
  </div>`;
}

export function checkEthereumWalletScript(): string {
  return `function checkEthWallet() {
      var banner = document.getElementById('eth-banner');
      var mobileNotice = document.getElementById('eth-mobile-notice');
      var btn = document.getElementById('btn-authorize');
      var copyBtn = document.getElementById('btn-copy-url');

      if (window.ethereum) {
        if (banner) banner.style.display = 'none';
        if (mobileNotice) mobileNotice.style.display = 'none';
        if (btn) { btn.disabled = false; btn.textContent = 'Sign with Ethereum'; }
        return;
      }

      if (isMobileDevice()) {
        if (banner) banner.style.display = 'none';
        if (mobileNotice) mobileNotice.style.display = 'flex';
        if (copyBtn) {
          copyBtn.addEventListener('click', function() {
            navigator.clipboard.writeText(window.location.href).then(function() {
              copyBtn.textContent = 'Copied!';
              setTimeout(function() { copyBtn.textContent = 'Copy URL'; }, 1500);
            });
          });
        }
      } else {
        if (banner) banner.style.display = 'flex';
      }

      if (btn) {
        btn.disabled = true;
        btn.textContent = 'No wallet detected';
        btn.title = 'Install an Ethereum wallet to continue';
      }
    }
    setTimeout(checkEthWallet, 500);
    setTimeout(checkEthWallet, 2000);`;
}
