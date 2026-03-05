import { getPool } from './pool';

export interface DbDeviceCode {
  deviceCode: string;
  userCode: string;
  clientId: string;
  scopes: string[];
  approved: boolean;
  denied: boolean;
  address: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  lastPolledAt: Date | null;
}

function rowToDeviceCode(row: any): DbDeviceCode {
  return {
    deviceCode: row.device_code,
    userCode: row.user_code,
    clientId: row.client_id,
    scopes: row.scopes || [],
    approved: row.approved,
    denied: row.denied,
    address: row.address,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastPolledAt: row.last_polled_at,
  };
}

export async function createDeviceCode(
  deviceCode: string,
  userCode: string,
  clientId: string,
  scopes: string[],
  expiresAt: Date,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    'INSERT INTO device_codes (device_code, user_code, client_id, scopes, expires_at) VALUES ($1, $2, $3, $4, $5)',
    [deviceCode, userCode, clientId, scopes, expiresAt],
  );
}

export async function getDeviceCode(deviceCode: string): Promise<DbDeviceCode | null> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM device_codes WHERE device_code = $1', [deviceCode]);
  if (rows.length === 0) return null;
  return rowToDeviceCode(rows[0]);
}

export async function getDeviceCodeByUserCode(userCode: string): Promise<DbDeviceCode | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM device_codes WHERE user_code = $1 AND approved = FALSE AND denied = FALSE AND expires_at > now()',
    [userCode],
  );
  if (rows.length === 0) return null;
  return rowToDeviceCode(rows[0]);
}

export async function approveDeviceCode(userCode: string, address: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    'UPDATE device_codes SET approved = TRUE, address = $1, approved_at = now() WHERE user_code = $2 AND approved = FALSE AND denied = FALSE',
    [address, userCode],
  );
  return (rowCount ?? 0) > 0;
}

export async function denyDeviceCode(userCode: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    'UPDATE device_codes SET denied = TRUE WHERE user_code = $1 AND approved = FALSE AND denied = FALSE',
    [userCode],
  );
  return (rowCount ?? 0) > 0;
}

export async function updateLastPolledAt(deviceCode: string): Promise<void> {
  const pool = getPool();
  await pool.query('UPDATE device_codes SET last_polled_at = now() WHERE device_code = $1', [deviceCode]);
}

export async function deleteDeviceCode(deviceCode: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM device_codes WHERE device_code = $1', [deviceCode]);
}

export async function cleanupExpiredDeviceCodes(): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM device_codes WHERE expires_at < now()');
}

export async function clearDeviceCodes(): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM device_codes');
}
