import { config } from '../config';

export function testnetBannerHtml(): string {
  if (!config.isTestnet) return '';
  return `<div class="testnet-banner">⚠ TESTNET — This instance is connected to the Bittensor testnet. Tokens and scopes have no mainnet value.</div>`;
}
