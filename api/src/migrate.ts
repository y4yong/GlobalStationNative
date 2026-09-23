import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './db.js';

const migrationPath = fileURLToPath(new URL('../sql/001_initial.sql', import.meta.url));
const statements = (await readFile(path.resolve(migrationPath), 'utf8'))
	.split(';')
	.map((statement) => statement.trim())
	.filter(Boolean);

for (const statement of statements) {
	await pool.query(statement);
}
await pool.end();
console.log('Database migration completed.');
