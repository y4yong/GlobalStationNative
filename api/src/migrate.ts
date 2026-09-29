import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './db.js';

async function applySql(sql: string) {
  const statements = sql.split(';').map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) {
    try {
      await pool.query(statement);
    } catch (error) {
      if (!['42P07', '42710'].includes((error as { code?: string }).code ?? '')) throw error;
    }
  }
}

const schemaPath = fileURLToPath(new URL('../sql/complete_globalstation.sql', import.meta.url));
const completeSql = await readFile(path.resolve(schemaPath), 'utf8');
const schemaSql = completeSql.split('-- Development seed users.')[0];
if (schemaSql === completeSql) throw new Error('Development seed boundary is missing from complete_globalstation.sql');
await applySql(schemaSql);

const integrationsPath = fileURLToPath(new URL('../sql/004_integrations.sql', import.meta.url));
await applySql(await readFile(path.resolve(integrationsPath), 'utf8'));

await pool.end();
console.log('Database schema and integration migrations completed without development seed data.');
