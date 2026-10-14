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
  const analyticsPath = fileURLToPath(new URL('../sql/009_audience_analytics.sql', import.meta.url));
  const analyticsMigration = await readFile(path.resolve(analyticsPath), 'utf8');
  for (const statement of analyticsMigration.split(';').map((part) => part.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
  const engagementPath = fileURLToPath(new URL('../sql/010_engagement_referrals.sql', import.meta.url));
  const engagementMigration = await readFile(path.resolve(engagementPath), 'utf8');
  for (const statement of engagementMigration.split(';').map((part) => part.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
  const dualPosterPath = fileURLToPath(new URL('../sql/011_dual_content_posters.sql', import.meta.url));
  const dualPosterMigration = await readFile(path.resolve(dualPosterPath), 'utf8');
  for (const statement of dualPosterMigration.split(';').map((part) => part.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
  console.log('Integration, analytics, engagement, and dual-poster schema migrations completed.');
} finally {
  await pool.end();
}