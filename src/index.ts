import { cryptoWaitReady } from '@polkadot/util-crypto';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import formbody from '@fastify/formbody';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { validatorCompiler, serializerCompiler, jsonSchemaTransform } from 'fastify-type-provider-zod';
import path from 'node:path';
import { config } from './config';
import { loadKeys } from './crypto/keys';
import { startChallengeCleanup, stopChallengeCleanup, waitForChallengeCleanup } from './crypto/challenge';
import { startDeviceCodeCleanup, stopDeviceCodeCleanup, waitForDeviceCodeCleanup } from './routes/device';
import { disconnectSubtensor, getSubtensorApi } from './subtensor/client';
import { registerRoutes, registerAdminRoutes } from './routes';
import { createErrorHandler } from './errorHandler';
import { startAuthCodeCleanup, stopAuthCodeCleanup, waitForAuthCodeCleanup } from './crypto/authCodeTracker';
import { getPool, getPoolStats, disconnectDb } from './db/pool';
import { runMigrations } from './db/migrate';
import { getAllowedOrigins } from './db/clients';
import { startRefreshTokenCleanup, stopRefreshTokenCleanup, waitForRefreshTokenCleanup } from './db/refreshTokens';
import { ensureDemoClients } from './demo';
import { setDemoClients } from './routes/landing';
import { normalizeAllowedOrigin } from './middleware/origin';
import {
  startAuthorizeSessionCleanup,
  stopAuthorizeSessionCleanup,
  waitForAuthorizeSessionCleanup,
} from './db/authorizeSessions';
import {
  startEventLogRollup,
  stopEventLogRollup,
  waitForEventLogRollup,
  startEventLogCleanup,
  stopEventLogCleanup,
  waitForEventLogCleanup,
  backfillMissingRollups,
} from './db/events';
import { createMetricsServer } from './metrics/server';
import {
  setDbPoolConnections,
  httpRequestDurationSeconds,
  activeRefreshTokens,
  setActiveRefreshTokens,
  setClientsRegistered,
} from './metrics/registry';

function createServer(): FastifyInstance {
  const server = Fastify({
    logger: { level: config.nodeEnv === 'production' ? 'info' : 'debug' },
    bodyLimit: config.jsonBodyLimitBytes,
    trustProxy: config.trustProxy,
  });
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  server.setErrorHandler(
    createErrorHandler({
      hideInternalErrors: config.nodeEnv === 'production',
      logErrors: true,
    }),
  );
  return server;
}

async function main(): Promise<void> {
  // Wait for WASM crypto to initialize
  await cryptoWaitReady();
  console.log('Substrate crypto ready');

  // Load RSA keys
  loadKeys();
  console.log('RSA keys loaded');

  // Initialize DB pool and verify connectivity
  const pool = getPool();
  await pool.query('SELECT 1');
  console.log('PostgreSQL pool initialized and connected');

  if (config.runMigrations) {
    await runMigrations();
    console.log('Migrations complete');
  }

  // Bootstrap demo clients if demo mode is enabled
  if (config.demoMode) {
    const demoClients = await ensureDemoClients(config.publicUrl);
    setDemoClients(demoClients);
    console.log(`Demo mode enabled — bittensor: ${demoClients.bittensorClientId}, evm: ${demoClients.evmClientId}, cli: ${demoClients.cliClientId}`);
  }

  // Eagerly connect to Subtensor so health checks pass at startup
  await getSubtensorApi();
  console.log(`Subtensor connected (${config.network})`);

  if (config.isTestnet) {
    console.warn('⚠ TESTNET MODE — connected to Bittensor testnet. Tokens and scopes have no mainnet value.');
  }

  // Create Fastify instance
  const server = createServer();

  server.addHook('onRequest', async (request) => {
    (request as any).__startTime = Date.now();
  });
  server.addHook('onResponse', async (request, reply) => {
    const start = (request as any).__startTime as number | undefined;
    if (start) {
      const duration = (Date.now() - start) / 1000;
      httpRequestDurationSeconds.observe(
        { route: request.routeOptions?.url ?? 'unmatched', method: request.method, status: String(reply.statusCode) },
        duration,
      );
    }
  });

  // Register Swagger (OpenAPI 3.0)
  await server.register(swagger, {
    openapi: {
      info: {
        title: 'Taostats Auth Gateway',
        description:
          'Bittensor and Ethereum wallet authentication with on-chain scope verification. Supports sr25519 (Bittensor) and EVM (Ethereum) wallet signatures. JWTs include `hotkey`/`coldkey` claims for Bittensor wallets and `evm_address` for Ethereum wallets.',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          adminApiKey: {
            type: 'apiKey',
            name: 'X-Admin-API-Key',
            in: 'header',
          },
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  // Register Swagger UI at /docs
  // baseDir is required because esbuild bundles into dist/index.js,
  // so the default __dirname-relative path won't resolve correctly.
  await server.register(swaggerUi, {
    routePrefix: '/docs',
    baseDir: path.join(__dirname, 'static'),
  });

  // Register plugins — dynamic CORS origin validation
  await server.register(cors, {
    origin: async (origin: string | undefined) => {
      if (!origin) return true;

      let normalizedOrigin: string;
      try {
        normalizedOrigin = normalizeAllowedOrigin(origin);
      } catch {
        return false;
      }

      try {
        const allowedOrigins = await getAllowedOrigins();
        if (allowedOrigins.has(normalizedOrigin)) return true;
      } catch {
        // DB not available — fall back to deny
      }

      if (config.nodeEnv !== 'production') {
        const url = new URL(normalizedOrigin);
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
      }

      return false;
    },
    credentials: true,
  });

  await server.register(rateLimit, {
    max: config.rateLimitGlobal,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      // Per-client rate limiting when client_id is present
      const body = request.body as Record<string, unknown> | undefined;
      const clientId = body?.['client_id'] as string | undefined;
      if (clientId) {
        return `client:${clientId}`;
      }
      return request.ip;
    },
  });

  await server.register(formbody);

  // Register routes
  const adminPort = config.adminPort !== config.port ? config.adminPort : undefined;
  await registerRoutes(server, { excludeAdmin: !!adminPort });

  // Start admin server on separate port if configured
  let adminServer: FastifyInstance | undefined;
  if (adminPort) {
    adminServer = createServer();
    await registerAdminRoutes(adminServer);
  }

  // Start cleanup intervals
  startChallengeCleanup();
  startDeviceCodeCleanup();
  startAuthCodeCleanup();
  startRefreshTokenCleanup();
  startAuthorizeSessionCleanup();
  if (config.enableEventLog) {
    await backfillMissingRollups();
    startEventLogRollup();
    startEventLogCleanup();
  }

  // Poll DB pool stats into the Prometheus gauge
  const poolStatsInterval = setInterval(() => {
    const stats = getPoolStats();
    setDbPoolConnections(stats.active, stats.idle);
  }, 15_000);
  poolStatsInterval.unref();

  // Periodic gauge updates for refresh tokens and registered clients
  const gaugeInterval = setInterval(async () => {
    try {
      const { rows: tokenRows } = await getPool().query<{ client_id: string; count: string }>(
        'SELECT client_id, COUNT(*)::text AS count FROM refresh_tokens WHERE revoked = FALSE AND expires_at > now() GROUP BY client_id',
      );
      activeRefreshTokens.reset();
      for (const row of tokenRows) {
        setActiveRefreshTokens(row.client_id, parseInt(row.count, 10));
      }
      const { rows: clientRows } = await getPool().query<{ active: boolean; count: string }>(
        'SELECT active, COUNT(*)::text AS count FROM oauth_clients GROUP BY active',
      );
      let activeCount = 0;
      let inactiveCount = 0;
      for (const row of clientRows) {
        if (row.active) activeCount = parseInt(row.count, 10);
        else inactiveCount = parseInt(row.count, 10);
      }
      setClientsRegistered(activeCount, inactiveCount);
    } catch {
      // Gauge update failure is non-critical
    }
  }, 60_000);
  gaugeInterval.unref();

  // Start servers
  const metricsServer = createMetricsServer();
  const listenOpts = { host: config.host };
  await Promise.all([
    server.listen({ ...listenOpts, port: config.port }),
    adminServer?.listen({ ...listenOpts, port: adminPort! }),
    metricsServer.listen({ ...listenOpts, port: config.metricsPort }),
  ]);
  console.log(`Auth gateway listening on ${config.host}:${config.port}`);
  if (adminPort) {
    console.log(`Admin API listening on ${config.host}:${adminPort}`);
  }
  console.log(`Metrics server listening on ${config.host}:${config.metricsPort}`);

  // Graceful shutdown
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down...`);

    const forceExit = setTimeout(() => {
      console.error('Shutdown timed out after 30s, forcing exit');
      process.exit(1);
    }, 30_000);
    forceExit.unref();

    stopChallengeCleanup();
    stopDeviceCodeCleanup();
    stopAuthCodeCleanup();
    stopRefreshTokenCleanup();
    stopAuthorizeSessionCleanup();
    stopEventLogRollup();
    stopEventLogCleanup();
    clearInterval(poolStatsInterval);
    clearInterval(gaugeInterval);
    await Promise.allSettled([
      waitForChallengeCleanup(),
      waitForDeviceCodeCleanup(),
      waitForAuthCodeCleanup(),
      waitForRefreshTokenCleanup(),
      waitForAuthorizeSessionCleanup(),
      waitForEventLogRollup(),
      waitForEventLogCleanup(),
    ]);
    await metricsServer.close();
    if (adminServer) await adminServer.close();
    await server.close();
    await disconnectSubtensor();
    await disconnectDb();
    console.log('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start auth gateway:', err);
  process.exit(1);
});
