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
  const demoCleanupPath = fileURLToPath(new URL('../sql/012_remove_demo_content_and_ad.sql', import.meta.url));
  const demoCleanupMigration = await readFile(path.resolve(demoCleanupPath), 'utf8');
  for (const statement of demoCleanupMigration.split(';').map((part) => part.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
  const viewerLocationPath = fileURLToPath(new URL('../sql/013_viewer_location_sharing.sql', import.meta.url));
  const viewerLocationMigration = await readFile(path.resolve(viewerLocationPath), 'utf8');
  for (const statement of viewerLocationMigration.split(';').map((part) => part.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
  const viewerLocationRegionsPath = fileURLToPath(new URL('../sql/014_viewer_location_regions.sql', import.meta.url));
  const viewerLocationRegionsMigration = await readFile(path.resolve(viewerLocationRegionsPath), 'utf8');
  for (const statement of viewerLocationRegionsMigration.split(';').map((part) => part.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
  for (const migrationName of ['015_schema_reconciliation.sql', '016_ad_targeting_and_qualified_impressions.sql', '017_malaysia_state_ad_targeting.sql', '018_industry_marketplace.sql']) {
    const migrationPath = fileURLToPath(new URL(`../sql/${migrationName}`, import.meta.url));
    const migration = await readFile(path.resolve(migrationPath), 'utf8');
    for (const statement of migration.split(';').map((part) => part.trim()).filter(Boolean)) {
      await pool.query(statement);
    }
  }
  console.log('Integration, analytics, engagement, dual-poster, demo-cleanup, location, schema-reconciliation, ad-targeting, and Malaysia-state migrations completed.');
} finally {
  await pool.end();
}
