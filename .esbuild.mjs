import { build } from 'esbuild';
import { cp } from 'node:fs/promises';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  outfile: 'dist/index.js',
  format: 'cjs',
  sourcemap: true,
  external: [
    '@polkadot/api',
    '@polkadot/util-crypto',
    '@polkadot/keyring',
    '@polkadot/util',
    '@polkadot/wasm-crypto',
    'pg',
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
