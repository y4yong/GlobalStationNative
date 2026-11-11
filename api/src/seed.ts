import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './db.js';

const sqlPath = fileURLToPath(new URL('../sql/complete_globalstation.sql', import.meta.url));
const sql = await readFile(path.resolve(sqlPath), 'utf8');
await pool.query(sql);
const cleanupPath = fileURLToPath(new URL('../sql/012_remove_demo_content_and_ad.sql', import.meta.url));
const cleanupSql = await readFile(path.resolve(cleanupPath), 'utf8');
await pool.query(cleanupSql);
await pool.end();
console.log('CINEVA PostgreSQL schema and seed data applied without retired demo content or ads.');
