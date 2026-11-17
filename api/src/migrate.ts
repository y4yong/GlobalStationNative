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
      const code = (error as { code?: string }).code ?? '';
      const incompatibleExistingView = code === '42P16' && /^CREATE\s+OR\s+REPLACE\s+VIEW/i.test(statement);
      if (!['42P07', '42710'].includes(code) && !incompatibleExistingView) throw error;
    }
  }
}

const schemaPath = fileURLToPath(new URL('../sql/complete_globalstation.sql', import.meta.url));
const completeSql = await readFile(path.resolve(schemaPath), 'utf8');
const schemaSql = completeSql.split('-- Development seed users.')[0];
if (schemaSql === completeSql) throw new Error('Development seed boundary is missing from complete_globalstation.sql');
await applySql(schemaSql);

const { rows: regionTypeRows } = await pool.query<{ udt_name: string }>(`
  SELECT udt_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'content' AND column_name = 'available_regions'
`);
if (regionTypeRows[0]?.udt_name === 'geography') {
  await pool.query('CREATE INDEX IF NOT EXISTS content_regions_gist_idx ON content USING GIST(available_regions)');
}
const { rows: locationTypeRows } = await pool.query<{ udt_name: string }>(`
  SELECT udt_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'watch_logs' AND column_name = 'location'
`);
if (locationTypeRows[0]?.udt_name === 'geography') {
  await pool.query('CREATE INDEX IF NOT EXISTS watch_logs_location_gist_idx ON watch_logs USING GIST(location)');
}

const integrationsPath = fileURLToPath(new URL('../sql/004_integrations.sql', import.meta.url));
await applySql(await readFile(path.resolve(integrationsPath), 'utf8'));

const rolesPath = fileURLToPath(new URL('../sql/005_user_roles.sql', import.meta.url));
await applySql(await readFile(path.resolve(rolesPath), 'utf8'));

const contentArchivePath = fileURLToPath(new URL('../sql/006_content_archive.sql', import.meta.url));
await applySql(await readFile(path.resolve(contentArchivePath), 'utf8'));

const campaignReviewPath = fileURLToPath(new URL('../sql/007_campaign_review.sql', import.meta.url));
await applySql(await readFile(path.resolve(campaignReviewPath), 'utf8'));

const campaignAudiencePath = fileURLToPath(new URL('../sql/008_campaign_audience.sql', import.meta.url));
await applySql(await readFile(path.resolve(campaignAudiencePath), 'utf8'));

const audienceAnalyticsPath = fileURLToPath(new URL('../sql/009_audience_analytics.sql', import.meta.url));
await applySql(await readFile(path.resolve(audienceAnalyticsPath), 'utf8'));

const engagementPath = fileURLToPath(new URL('../sql/010_engagement_referrals.sql', import.meta.url));
await applySql(await readFile(path.resolve(engagementPath), 'utf8'));

const dualPosterPath = fileURLToPath(new URL('../sql/011_dual_content_posters.sql', import.meta.url));
await applySql(await readFile(path.resolve(dualPosterPath), 'utf8'));

const demoCleanupPath = fileURLToPath(new URL('../sql/012_remove_demo_content_and_ad.sql', import.meta.url));
await applySql(await readFile(path.resolve(demoCleanupPath), 'utf8'));

const viewerLocationPath = fileURLToPath(new URL('../sql/013_viewer_location_sharing.sql', import.meta.url));
await applySql(await readFile(path.resolve(viewerLocationPath), 'utf8'));

const viewerLocationRegionsPath = fileURLToPath(new URL('../sql/014_viewer_location_regions.sql', import.meta.url));
await applySql(await readFile(path.resolve(viewerLocationRegionsPath), 'utf8'));

const schemaReconciliationPath = fileURLToPath(new URL('../sql/015_schema_reconciliation.sql', import.meta.url));
await applySql(await readFile(path.resolve(schemaReconciliationPath), 'utf8'));

const adTargetingPath = fileURLToPath(new URL('../sql/016_ad_targeting_and_qualified_impressions.sql', import.meta.url));
await applySql(await readFile(path.resolve(adTargetingPath), 'utf8'));

const malaysiaStateTargetingPath = fileURLToPath(new URL('../sql/017_malaysia_state_ad_targeting.sql', import.meta.url));
await applySql(await readFile(path.resolve(malaysiaStateTargetingPath), 'utf8'));

const industryMarketplacePath = fileURLToPath(new URL('../sql/018_industry_marketplace.sql', import.meta.url));
await applySql(await readFile(path.resolve(industryMarketplacePath), 'utf8'));

const demoContentCleanupPath = fileURLToPath(new URL('../sql/019_remove_remaining_demo_content.sql', import.meta.url));
await applySql(await readFile(path.resolve(demoContentCleanupPath), 'utf8'));

const coinsAndTracksPath = fileURLToPath(new URL('../sql/020_coins_and_episode_tracks.sql', import.meta.url));
await applySql(await readFile(path.resolve(coinsAndTracksPath), 'utf8'));

await pool.end();
console.log('Database schema and integration migrations completed without development seed data.');
