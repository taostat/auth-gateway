/**
 * Shared CSS served at /static/styles.css
 * All HTML pages link to this stylesheet.
 * Uses Inter font from Google Fonts (closest match to Taostats Everett).
 */

/** HTML <head> links for fonts + shared stylesheet */
export const cssLinks = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&display=swap">
  <link rel="stylesheet" href="/static/styles.css">
  <link rel="icon" href="/favicon.ico">`;

export const sharedCss = `
@font-face { font-family: 'Everett'; font-weight: 400; font-style: normal; font-display: swap; src: url('/static/fonts/TWKEverett-Regular-web.woff2') format('woff2'); }
@font-face { font-family: 'Everett'; font-weight: 500; font-style: normal; font-display: swap; src: url('/static/fonts/TWKEverett-Medium-web.woff2') format('woff2'); }
@font-face { font-family: 'Everett'; font-weight: 700; font-style: normal; font-display: swap; src: url('/static/fonts/TWKEverett-Bold-web.woff2') format('woff2'); }

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #121212;
  --surface: #1B1B1B;
  --border: #262626;
  --accent: #00DBBC;
  --accent-hover: #66E8D5;
  --accent-dark: #00B89A;
  --accent-red: #EB5347;
  --text: #fafafa;
  --text-secondary: #a5a5a5;
  --text-muted: #5a5a5a;
  --error: #fd4848;
  --success: #6CFC69;
  --font: 'Everett', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'Fira Code', 'SF Mono', monospace;
  --radius: 12px;
  --radius-sm: 8px;
}

/* Starry background container (stars created by JS) */
.starry-bg { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }

body {
  font-family: var(--font);
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 20px;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  position: relative;
  z-index: 1;
}

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

h1 { font-size: 1.4rem; margin-bottom: 0.25rem; font-weight: 500; }
.subtitle { color: var(--text-secondary); margin-bottom: 2rem; font-size: 1.05rem; }

/* Logo */
.logo { margin-bottom: 1.5rem; }
.logo svg { display: block; }

code { font-family: var(--font-mono); color: var(--accent); }

/* Cards */
.card {
  background: #1e1e1e;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  margin: 1rem 0;
  position: relative;
  z-index: 2;
}
.card h3 { font-size: 1rem; margin-bottom: 12px; color: #ccc; font-weight: 500; }

/* Lists */
.link-list { list-style: none; }
.link-list li { padding: 8px 0; border-bottom: 1px solid var(--border); }
.link-list li:last-child { border-bottom: none; }
.link-list .path { font-family: var(--font-mono); font-size: 0.9rem; color: var(--accent); }
.link-list .desc { color: var(--text-muted); font-size: 0.85rem; margin-left: 8px; }

/* Badges */
.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
.badge.demo { background: rgba(0,219,188,0.15); color: var(--accent); }

/* Buttons */
.btn {
  display: inline-block;
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  border: none;
  font-size: 0.95rem;
  cursor: pointer;
  text-decoration: none;
  margin: 4px;
  font-family: var(--font);
  font-weight: 400;
}
.btn-primary { background: var(--accent); color: #000; border-radius: var(--radius-sm); transition: all 0.2s ease; }
.btn-primary:hover { background: var(--accent-hover); text-decoration: none; transform: scale(1.05); }
.btn-secondary { background: transparent; color: var(--text-secondary); border: 1px solid #444; transition: all 0.2s ease; }
.btn-secondary:hover { background: var(--border); color: var(--text); text-decoration: none; }
button:disabled { background: #262626 !important; color: #5a5a5a !important; cursor: not-allowed; transform: none !important; }

/* Status */
.status { border-radius: var(--radius-sm); font-size: 0.9rem; line-height: 1.5; }
.status:not(:empty) { padding: 14px 16px; margin: 16px 0 0 0; }
.status.loading { background: var(--surface); color: var(--text-secondary); }
.status.error { display: block; background: rgba(255,82,82,0.1); border: 1px solid rgba(255,82,82,0.3); color: #ff6b6b; font-weight: 500; }
.status.success { display: block; background: rgba(105,240,174,0.1); border: 1px solid rgba(105,240,174,0.3); color: var(--success); font-weight: 500; }

/* Scopes */
.scopes-box {
  border-top: 1px solid var(--border);
  margin: 20px 0 0 0;
  padding: 0;
}
.scopes-box h3 { margin: 0; padding: 16px 0 4px 0; font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500; }
.scope-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
  font-size: 0.95rem;
  color: var(--text);
}
.scope-item:last-child { border-bottom: none; }
.scope-item .raw { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted); word-break: break-all; }
.no-scopes { color: var(--text-secondary); font-style: italic; }

/* Forms */
input, select {
  font-family: var(--font);
  background: var(--border);
  color: var(--text);
  border: 1px solid #333;
  border-radius: var(--radius-sm);
  padding: 8px;
  font-size: 0.9rem;
}
input:focus, select:focus { outline: 1px solid var(--accent); border-color: var(--accent); }

/* Pre/code blocks */
pre {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  overflow-x: auto;
  font-size: 0.85rem;
  font-family: var(--font-mono);
  line-height: 1.5;
}

/* Footer */
footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--border); color: #555; font-size: 0.85rem; }

/* Error page */
.error-box {
  background: rgba(255,82,82,0.1);
  border: 1px solid rgba(255,82,82,0.25);
  border-radius: var(--radius);
  padding: 16px;
  color: var(--error);
}

/* Narrow pages (authorize, device verify, error) */
body.narrow { max-width: 480px; margin: 60px auto; }

/* Auth page header */
.auth-header {
  text-align: center;
  margin-bottom: 24px;
}
.auth-header svg { display: inline-block; }

/* Auth card container */
.auth-card {
  background: #1e1e1e;
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 32px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.4);
  position: relative;
  z-index: 2;
}
.auth-card h1 { font-size: 1.15rem; margin-bottom: 6px; font-weight: 500; }

/* Page-specific: authorize */
.info { color: var(--text-secondary); margin-bottom: 0; font-size: 0.9rem; line-height: 1.5; }
.btn-row { display: flex; gap: 12px; margin-top: 20px; justify-content: center; }
.btn-row .btn-deny { flex: none; }
.btn-row .btn-authorize { flex: none; }
.btn-authorize {
  background: var(--accent); color: #000; border: 2px solid transparent;
  padding: 10px 24px; border-radius: var(--radius-sm); font-size: 0.95rem;
  font-family: var(--font); font-weight: 400; cursor: pointer;
  transition: all 0.2s ease; min-width: 200px;
}
.btn-authorize:hover:not(:disabled) { background: var(--accent-hover); transform: scale(1.05); }
.btn-authorize:active:not(:disabled) { background: var(--accent-dark); transform: scale(0.98); }
.btn-deny {
  background: transparent; color: var(--text-secondary);
  border: 1px solid var(--border); padding: 10px 24px;
  border-radius: var(--radius-sm); font-size: 0.95rem;
  font-family: var(--font); font-weight: 400; cursor: pointer;
  transition: all 0.2s ease;
}
.btn-deny:hover { background: var(--border); color: var(--text); }

/* Page-specific: device verify */
.code-input {
  width: 100%;
  padding: 12px;
  font-size: 1.2rem;
  text-align: center;
  letter-spacing: 0.2em;
  font-family: var(--font-mono);
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
}
.code-input:focus { outline: none; border-color: var(--accent); }
.btn-full {
  background: var(--accent);
  color: #000;
  border: 2px solid transparent;
  padding: 12px 24px;
  border-radius: var(--radius-sm);
  font-size: 1rem;
  font-family: var(--font);
  font-weight: 400;
  cursor: pointer;
  width: 100%;
  margin-top: 1rem;
  transition: all 0.2s ease;
}
.btn-full:hover:not(:disabled) { background: var(--accent-hover); transform: scale(1.05); }
.btn-full:active:not(:disabled) { background: var(--accent-dark); transform: scale(0.98); }
.btn-full:disabled { background: #262626; color: #5a5a5a; cursor: not-allowed; }

/* Account picker */
.account-picker { margin: 1rem 0; }
.account-picker label { font-size: 0.9rem; color: var(--text-secondary); }
.account-select {
  width: 100%;
  padding: 10px;
  font-family: var(--font-mono);
  font-size: 0.85rem;
  background: var(--surface);
  color: var(--text);
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  margin-top: 6px;
}

/* Testnet warning banner */
.testnet-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(255, 193, 7, 0.15);
  border: 1px solid rgba(255, 193, 7, 0.4);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  margin-bottom: 1rem;
  font-size: 0.85rem;
  color: #ffc107;
  font-weight: 500;
}

/* Wallet install banner */
.wallet-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: rgba(0,219,188,0.1);
  border: 1px solid rgba(0,219,188,0.25);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  margin-bottom: 1rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}
.wallet-banner a { font-weight: 500; }
.wallet-banner button {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.1rem;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.wallet-banner button:hover { color: var(--text); }

/* CLI signing toggle */
.cli-toggle {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 12px 0 0 0;
  color: var(--text-muted);
  font-size: 0.8rem;
}
.cli-toggle::before, .cli-toggle::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}
.cli-toggle a { color: var(--text-muted); white-space: nowrap; }
.cli-toggle a:hover { color: var(--accent); text-decoration: none; }

/* CLI signing section */
.cli-section {
  margin-top: 1rem;
}
.cli-step {
  font-size: 0.85rem;
  color: var(--text);
  font-weight: 600;
  margin: 1.25rem 0 0.5rem 0;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}
.cmd-block {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px 48px 12px 12px;
  font-family: var(--font-mono);
  font-size: 0.82rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}
.cmd-copy {
  position: absolute;
  top: 8px;
  right: 8px;
  background: var(--border);
  border: none;
  color: var(--text-secondary);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 0.75rem;
  cursor: pointer;
  font-family: var(--font);
}
.cmd-copy:hover { background: #333; color: var(--text); }
.sig-input {
  width: 100%;
  min-height: 60px;
  font-family: var(--font-mono);
  font-size: 0.82rem;
  background: var(--surface);
  color: var(--text);
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px;
  resize: vertical;
  margin-top: 6px;
}
.sig-input:focus { outline: none; border-color: var(--accent); }
.addr-input {
  width: 100%;
  font-family: var(--font-mono);
  font-size: 0.82rem;
  background: var(--surface);
  color: var(--text);
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px;
  margin-top: 6px;
}
.addr-input:focus { outline: none; border-color: var(--accent); }

/* Powered-by branding */
.powered-by {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 24px;
  color: var(--text-muted);
  font-size: 0.75rem;
}
.powered-by svg { opacity: 0.4; }
.powered-by a { color: var(--text-muted); }
.powered-by a:hover { color: var(--text); }
.powered-by a:hover svg { opacity: 0.7; }
`;
