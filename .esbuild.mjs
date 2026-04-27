import { build } from 'esbuild';
import { cp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  outfile: 'dist/index.js',
  format: 'cjs',
  sourcemap: true,
  define: { '__APP_VERSION__': JSON.stringify(pkg.version) },
  external: [
    '@polkadot/api',
    '@polkadot/util-crypto',
    '@polkadot/keyring',
    '@polkadot/util',
    '@polkadot/wasm-crypto',
    'pg',
    // require.resolve target for the dev-mode swagger-ui fallback.
    '@fastify/swagger-ui/static/index.html',
  ],
});

await cp(
  'node_modules/@fastify/swagger-ui/static',
  'dist/static',
  { recursive: true },
);

await cp('src/static', 'dist/static', { recursive: true });

// Bundle @polkadot/extension-dapp for browser (self-hosted, no CDN)
await build({
  entryPoints: ['src/browser/extension-dapp.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  outfile: 'dist/static/extension-dapp.js',
  minify: true,
});

console.log('Build complete: dist/index.js');
