import fs from 'fs';
import path from 'path';
import { getPool } from './pool';

function resolveMigrationsDir(): string | null {
  const candidates = [
    process.env['MIGRATIONS_DIR'],
    path.resolve(process.cwd(), 'migrations'),
    path.resolve(__dirname, '../migrations'),
    path.resolve(__dirname, '../../migrations'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  const lockClient = await pool.connect();
  try {
    // Create migration lock table for multi-instance safety
    await lockClient.query(`
      CREATE TABLE IF NOT EXISTS _migration_lock (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        locked_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await lockClient.query(
      'INSERT INTO _migration_lock (id) VALUES (1) ON CONFLICT DO NOTHING',
    );

    // Acquire row-level lock (held for duration of transaction)
    await lockClient.query('BEGIN');
    await lockClient.query(
      'SELECT * FROM _migration_lock WHERE id = 1 FOR UPDATE',
    );

    // Create migrations tracking table
    await lockClient.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Read migration files
    const migrationsDir = resolveMigrationsDir();
    if (!migrationsDir) {
      console.log('No migrations directory found, skipping');
      return;
    }

    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No migration files found');
      return;
    }

    // Get already-applied migrations
    const { rows } = await lockClient.query('SELECT name FROM _migrations');
    const applied = new Set(rows.map((r: { name: string }) => r.name));

    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      console.log(`Running migration: ${file}`);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Migration applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      } finally {
        client.release();
      }
    }
  } finally {
    try {
      await lockClient.query('COMMIT');
    } catch {
      await lockClient.query('ROLLBACK').catch(() => {});
    } finally {
      lockClient.release();
    }
  }
}
