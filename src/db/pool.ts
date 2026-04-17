import { Pool } from 'pg';
import { config } from '../config';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err.message);
    });
  }
  return pool;
}

export async function disconnectDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export interface PoolStats {
  active: number;
  idle: number;
}

export function getPoolStats(): PoolStats {
  if (!pool) return { active: 0, idle: 0 };
  const total = pool.totalCount;
  const idle = pool.idleCount;
  const active = Math.max(0, total - idle);
  return { active, idle };
}
