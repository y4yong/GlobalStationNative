import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './db.js';

const sqlPath = fileURLToPath(new URL('../sql/complete_globalstation.sql', import.meta.url));
const sql = await readFile(path.resolve(sqlPath), 'utf8');
await pool.query(sql);
await pool.end();
console.log('Global Station PostgreSQL schema and seed data applied.');
