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
const remainingCleanupPath = fileURLToPath(new URL('../sql/019_remove_remaining_demo_content.sql', import.meta.url));
const remainingCleanupSql = await readFile(path.resolve(remainingCleanupPath), 'utf8');
await pool.query(remainingCleanupSql);
const coinsAndTracksPath = fileURLToPath(new URL('../sql/020_coins_and_episode_tracks.sql', import.meta.url));
const coinsAndTracksSql = await readFile(path.resolve(coinsAndTracksPath), 'utf8');
await pool.query(coinsAndTracksSql);
await pool.end();
console.log('CINEVA PostgreSQL schema and seed data applied without demo content or ads.');
