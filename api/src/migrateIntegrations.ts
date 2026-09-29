import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './db.js';

try {
  const migrationPath = fileURLToPath(new URL('../sql/004_integrations.sql', import.meta.url));
  const migration = await readFile(path.resolve(migrationPath), 'utf8');
  for (const statement of migration.split(';').map((part) => part.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
  console.log('Integration schema migration completed.');
} finally {
  await pool.end();
}