import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { config } from '../config';

export const register = new Registry();

collectDefaultMetrics({ register, prefix: 'auth_gateway_' });

const PREFIX = 'auth_gateway_';

export const tokenExchangesTotal = new Counter({
  name: `${PREFIX}token_exchanges_total`,
  help: 'OAuth token exchange attempts',
  labelNames: ['client_id', 'grant_type', 'outcome', 'error_reason', 'sign_method'],
  registers: [register],
});

export const authorizeRequestsTotal = new Counter({
  name: `${PREFIX}authorize_requests_total`,
  help: 'OAuth /authorize requests',
  labelNames: ['client_id', 'response_type', 'outcome', 'error_reason'],
  registers: [register],
});

export const refreshRotationsTotal = new Counter({
  name: `${PREFIX}refresh_rotations_total`,
  help: 'Refresh token rotations',
  labelNames: ['client_id', 'outcome', 'error_reason'],
  registers: [register],
});

export const deviceCodeFlowTotal = new Counter({
  name: `${PREFIX}device_code_flow_total`,
  help: 'Device code flow stage transitions',
  labelNames: ['client_id', 'stage', 'outcome'],
  registers: [register],
});

export const challengesTotal = new Counter({
  name: `${PREFIX}challenges_total`,
  help: 'Signing challenges issued and verified',
  labelNames: ['sign_method', 'outcome'],
  registers: [register],
});

export const scopeRequestsTotal = new Counter({
  name: `${PREFIX}scope_requests_total`,
  help: 'Scope grant/reject decisions',
  labelNames: ['client_id', 'scope', 'outcome'],
  registers: [register],
});

export const rateLimitHitsTotal = new Counter({
  name: `${PREFIX}rate_limit_hits_total`,
  help: 'Per-client rate limit rejections',
  labelNames: ['client_id', 'endpoint'],
  registers: [register],
});

export const adminApiRequestsTotal = new Counter({
  name: `${PREFIX}admin_api_requests_total`,
  help: 'Admin API request counts',
  labelNames: ['endpoint', 'outcome'],
  registers: [register],
});

export const httpRequestDurationSeconds = new Histogram({
  name: `${PREFIX}http_request_duration_seconds`,
  help: 'HTTP request duration',
  labelNames: ['route', 'method', 'status'],
  registers: [register],
});

export const subtensorQueryDurationSeconds = new Histogram({
  name: `${PREFIX}subtensor_query_duration_seconds`,
  help: 'Subtensor RPC query duration',
  labelNames: ['query', 'outcome'],
  registers: [register],
});

export const scryptVerifyDurationSeconds = new Histogram({
  name: `${PREFIX}scrypt_verify_duration_seconds`,
  help: 'scrypt client secret verification duration',
  registers: [register],
});

export const subtensorConnected = new Gauge({
  name: `${PREFIX}subtensor_connected`,
  help: 'Whether the Subtensor WebSocket is currently connected (0|1)',
  registers: [register],
});

export const dbPoolConnections = new Gauge({
  name: `${PREFIX}db_pool_connections`,
  help: 'PostgreSQL pool connection counts by state',
  labelNames: ['state'],
  registers: [register],
});

export const activeRefreshTokens = new Gauge({
  name: `${PREFIX}active_refresh_tokens`,
  help: 'Active (non-revoked, unexpired) refresh tokens per client',
  labelNames: ['client_id'],
  registers: [register],
});

export const clientsRegistered = new Gauge({
  name: `${PREFIX}clients_registered`,
  help: 'Registered OAuth clients, partitioned by active flag',
  labelNames: ['active'],
  registers: [register],
});

export const buildInfo = new Gauge({
  name: `${PREFIX}build_info`,
  help: 'Build metadata (always 1)',
  labelNames: ['version', 'commit'],
  registers: [register],
});

buildInfo.set({ version: config.version, commit: process.env['GIT_COMMIT'] ?? 'unknown' }, 1);

type GrantType =
  | 'authorization_code'
  | 'refresh_token'
  | 'urn:ietf:params:oauth:grant-type:device_code';
type Outcome = 'success' | 'failure';
type DeviceStage = 'issued' | 'polled' | 'approved' | 'denied' | 'expired';
type ScopeOutcome = 'granted' | 'rejected';

export function recordTokenExchange(input: {
  client_id: string;
  grant_type: GrantType;
  outcome: Outcome;
  error_reason?: string;
  sign_method?: string;
}): void {
  tokenExchangesTotal.inc({
    client_id: input.client_id,
    grant_type: input.grant_type,
    outcome: input.outcome,
    error_reason: input.error_reason ?? '',
    sign_method: input.sign_method ?? '',
  });
}

export function recordAuthorizeRequest(input: {
  client_id: string;
  response_type: string;
  outcome: Outcome;
  error_reason?: string;
}): void {
  authorizeRequestsTotal.inc({
    client_id: input.client_id,
    response_type: input.response_type,
    outcome: input.outcome,
    error_reason: input.error_reason ?? '',
  });
}

export function recordRefreshRotation(input: {
  client_id: string;
  outcome: Outcome;
  error_reason?: string;
}): void {
  refreshRotationsTotal.inc({
    client_id: input.client_id,
    outcome: input.outcome,
    error_reason: input.error_reason ?? '',
  });
}

export function recordDeviceCodeStage(input: {
  client_id: string;
  stage: DeviceStage;
  outcome: Outcome | 'pending';
}): void {
  deviceCodeFlowTotal.inc({
    client_id: input.client_id,
    stage: input.stage,
    outcome: input.outcome,
  });
}

export function recordChallenge(input: { sign_method: string; outcome: 'issued' | 'verified' | 'failure' }): void {
  challengesTotal.inc({ sign_method: input.sign_method, outcome: input.outcome });
}

export function recordScopeRequest(input: {
  client_id: string;
  scope: string;
  outcome: ScopeOutcome;
}): void {
  scopeRequestsTotal.inc(input);
}

export function recordRateLimitHit(input: { client_id: string; endpoint: string }): void {
  rateLimitHitsTotal.inc(input);
}

export function recordAdminApiRequest(input: { endpoint: string; outcome: Outcome }): void {
  adminApiRequestsTotal.inc(input);
}

export function setSubtensorConnected(connected: boolean): void {
  subtensorConnected.set(connected ? 1 : 0);
}

export function setDbPoolConnections(active: number, idle: number): void {
  dbPoolConnections.set({ state: 'active' }, active);
  dbPoolConnections.set({ state: 'idle' }, idle);
}

export function setActiveRefreshTokens(clientId: string, count: number): void {
  activeRefreshTokens.set({ client_id: clientId }, count);
}

export function setClientsRegistered(activeCount: number, inactiveCount: number): void {
  clientsRegistered.set({ active: 'true' }, activeCount);
  clientsRegistered.set({ active: 'false' }, inactiveCount);
}
