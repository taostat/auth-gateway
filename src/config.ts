import dotenv from 'dotenv';
dotenv.config();

function optionalEnv(name: string, defaultValue: string): string {
  const value = process.env[name];
  return value !== undefined && value !== '' ? value : defaultValue;
}

function intEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) throw new Error(`Invalid integer for ${name}: "${raw}"`);
  return parsed;
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

const network = optionalEnv('NETWORK', 'mainnet');
if (network !== 'mainnet' && network !== 'testnet') {
  throw new Error(`Invalid NETWORK value: "${network}". Must be "mainnet" or "testnet".`);
}

const isTestnet = network === 'testnet';
const subtensorDefault = isTestnet
  ? 'wss://test.finney.opentensor.ai:443'
  : 'wss://entrypoint-finney.opentensor.ai:443';

const publicUrl = normalizeUrl(optionalEnv('PUBLIC_URL', 'http://localhost:3000'));

export const config = {
  version: optionalEnv('APP_VERSION', typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'),
  port: intEnv('PORT', 3000),
  host: optionalEnv('HOST', '0.0.0.0'),
  nodeEnv: optionalEnv('NODE_ENV', 'development'),

  // Network
  network: network as 'mainnet' | 'testnet',
  isTestnet,

  // RSA Keys - support both file path and base64
  rsaPrivateKeyPath: process.env['RSA_PRIVATE_KEY_PATH'] || undefined,
  rsaPublicKeyPath: process.env['RSA_PUBLIC_KEY_PATH'] || undefined,
  rsaPrivateKeyBase64: process.env['RSA_PRIVATE_KEY_BASE64'] || undefined,
  rsaPublicKeyBase64: process.env['RSA_PUBLIC_KEY_BASE64'] || undefined,

  // JWT
  jwtIssuer: normalizeUrl(optionalEnv('JWT_ISSUER', publicUrl)),
  jwtAudience: optionalEnv('JWT_AUDIENCE', 'bittensor-apps'),
  jwtAccessTokenExpiry: intEnv('JWT_ACCESS_TOKEN_EXPIRY', 900),
  jwtRefreshTokenExpiry: intEnv('JWT_REFRESH_TOKEN_EXPIRY', 86400),
  jwtAuthCodeExpiry: intEnv('JWT_AUTH_CODE_EXPIRY', 30),

  // Subtensor
  subtensorWsUrl: optionalEnv('SUBTENSOR_WS_URL', subtensorDefault),
  subtensorBlockTime: intEnv('SUBTENSOR_BLOCK_TIME', 12),
  subtensorQueryTimeout: intEnv('SUBTENSOR_QUERY_TIMEOUT_MS', 10000),

  // Taostats API (fallback + indexed data scopes)
  taostatsApiUrl: optionalEnv('TAOSTATS_API_URL', 'https://api.taostats.io'),
  taostatsApiKey: process.env['TAOSTATS_API_KEY'] || undefined,

  // Challenge
  challengeTtlSeconds: intEnv('CHALLENGE_TTL_SECONDS', 120),

  // Device Code Flow
  deviceCodeTtlSeconds: intEnv('DEVICE_CODE_TTL_SECONDS', 300),
  deviceCodePollInterval: intEnv('DEVICE_CODE_POLL_INTERVAL', 5),
  verificationUri: optionalEnv('VERIFICATION_URI', `${publicUrl}/v1/device/verify`),

  // Rate Limits
  rateLimitGlobal: intEnv('RATE_LIMIT_GLOBAL', 10),
  rateLimitChallenge: intEnv('RATE_LIMIT_CHALLENGE', 5),

  // Database
  databaseUrl: optionalEnv('DATABASE_URL', 'postgresql://localhost:5432/auth_gateway'),

  // Admin API
  adminApiKey: process.env['ADMIN_API_KEY'] || undefined,

  // Migrations
  runMigrations: optionalEnv('RUN_MIGRATIONS', 'true') === 'true',

  // Public URL (for OIDC discovery)
  publicUrl,

  // Demo mode
  demoMode: optionalEnv('DEMO_MODE', 'false') === 'true',

  // Wallet banner
  walletBannerUrl: optionalEnv(
    'WALLET_BANNER_URL',
    'https://chromewebstore.google.com/detail/taostats-wallet/khdnjjgidjjbjpececegbfglalchffpo',
  ),

  // Request limits
  jsonBodyLimitBytes: intEnv('JSON_BODY_LIMIT_BYTES', 65536),
};

// Production safety checks
if (config.nodeEnv === 'production' && config.isTestnet) {
  console.warn('⚠ WARNING: Running testnet configuration in production environment');
}

if (config.nodeEnv === 'production' && !config.adminApiKey) {
  throw new Error('ADMIN_API_KEY must be set in production');
}

if (config.nodeEnv === 'production' && !process.env['DATABASE_URL']) {
  throw new Error('DATABASE_URL must be set in production');
}

if (config.nodeEnv === 'production') {
  const jwtIssuer = new URL(config.jwtIssuer);
  const isIssuerLocalhost = jwtIssuer.hostname === 'localhost' || jwtIssuer.hostname === '127.0.0.1';
  if (jwtIssuer.protocol !== 'https:' && !isIssuerLocalhost) {
    throw new Error('JWT_ISSUER must use HTTPS in production');
  }

  const verificationUrl = new URL(config.verificationUri);
  const isLocalhost = verificationUrl.hostname === 'localhost' || verificationUrl.hostname === '127.0.0.1';
  if (verificationUrl.protocol !== 'https:' && !isLocalhost) {
    throw new Error('VERIFICATION_URI must use HTTPS in production');
  }

  const publicUrl = new URL(config.publicUrl);
  const isPublicLocalhost = publicUrl.hostname === 'localhost' || publicUrl.hostname === '127.0.0.1';
  if (publicUrl.protocol !== 'https:' && !isPublicLocalhost) {
    throw new Error('PUBLIC_URL must use HTTPS in production');
  }

  if (config.jwtIssuer !== config.publicUrl) {
    throw new Error('JWT_ISSUER must match PUBLIC_URL in production for OIDC consistency');
  }
}
