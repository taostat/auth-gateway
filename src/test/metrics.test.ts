import {
  register,
  recordTokenExchange,
  recordAuthorizeRequest,
  recordDeviceCodeStage,
  recordChallenge,
  recordScopeRequest,
  recordRateLimitHit,
  recordAdminApiRequest,
  recordRefreshRotation,
  setSubtensorConnected,
  setDbPoolConnections,
  setActiveRefreshTokens,
  setClientsRegistered,
} from '../metrics/registry';
import { createMetricsServer } from '../metrics/server';

describe('Prometheus metrics', () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  test('records token exchanges', async () => {
    recordTokenExchange({
      client_id: 'abc',
      grant_type: 'authorization_code',
      outcome: 'success',
      sign_method: 'sr25519',
    });
    recordTokenExchange({
      client_id: 'abc',
      grant_type: 'refresh_token',
      outcome: 'failure',
      error_reason: 'invalid_grant',
      sign_method: 'evm',
    });

    const out = await register.metrics();
    expect(out).toMatch(/auth_gateway_token_exchanges_total\{[^}]*grant_type="authorization_code"[^}]*\} 1/);
    expect(out).toMatch(/auth_gateway_token_exchanges_total\{[^}]*error_reason="invalid_grant"[^}]*\} 1/);
  });

  test('records authorize, refresh rotations, device stages, challenges, scopes, rate limit hits, admin requests', async () => {
    recordAuthorizeRequest({ client_id: 'c1', response_type: 'code', outcome: 'success' });
    recordRefreshRotation({ client_id: 'c1', outcome: 'success' });
    recordDeviceCodeStage({ client_id: 'c1', stage: 'issued', outcome: 'success' });
    recordChallenge({ sign_method: 'sr25519', outcome: 'issued' });
    recordScopeRequest({ client_id: 'c1', scope: 'openid', outcome: 'granted' });
    recordRateLimitHit({ client_id: 'c1', endpoint: 'token' });
    recordAdminApiRequest({ endpoint: 'stats', outcome: 'success' });

    const out = await register.metrics();
    expect(out).toContain('auth_gateway_authorize_requests_total');
    expect(out).toContain('auth_gateway_refresh_rotations_total');
    expect(out).toContain('auth_gateway_device_code_flow_total');
    expect(out).toContain('auth_gateway_challenges_total');
    expect(out).toContain('auth_gateway_scope_requests_total');
    expect(out).toContain('auth_gateway_rate_limit_hits_total');
    expect(out).toContain('auth_gateway_admin_api_requests_total');
  });

  test('exposes gauges for subtensor, pool, refresh tokens, clients', async () => {
    setSubtensorConnected(true);
    setDbPoolConnections(3, 7);
    setActiveRefreshTokens('c1', 42);
    setClientsRegistered(5, 2);

    const out = await register.metrics();
    expect(out).toMatch(/auth_gateway_subtensor_connected 1/);
    expect(out).toMatch(/auth_gateway_db_pool_connections\{state="active"\} 3/);
    expect(out).toMatch(/auth_gateway_db_pool_connections\{state="idle"\} 7/);
    expect(out).toMatch(/auth_gateway_active_refresh_tokens\{client_id="c1"\} 42/);
    expect(out).toMatch(/auth_gateway_clients_registered\{active="true"\} 5/);
  });

  test('build_info gauge is registered with version and commit labels', async () => {
    const out = await register.metrics();
    expect(out).toContain('auth_gateway_build_info');
  });

  test('includes default node metrics', async () => {
    const out = await register.metrics();
    expect(out).toContain('auth_gateway_process_cpu_user_seconds_total');
    expect(out).toContain('auth_gateway_nodejs_eventloop_lag_seconds');
  });

  test('metrics server exposes /metrics endpoint', async () => {
    recordTokenExchange({
      client_id: 'abc',
      grant_type: 'authorization_code',
      outcome: 'success',
    });

    const app = createMetricsServer();
    try {
      const res = await app.inject({ method: 'GET', url: '/metrics' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.payload).toContain('auth_gateway_token_exchanges_total');
    } finally {
      await app.close();
    }
  });
});
