ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ad_personalization_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ad_age_range VARCHAR(10),
  ADD COLUMN IF NOT EXISTS ad_gender VARCHAR(20);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_ad_age_range_check;
ALTER TABLE users ADD CONSTRAINT users_ad_age_range_check
  CHECK (ad_age_range IS NULL OR ad_age_range IN ('18-24', '25-34', '35-44', '45+'));
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_ad_gender_check;
ALTER TABLE users ADD CONSTRAINT users_ad_gender_check
  CHECK (ad_gender IS NULL OR ad_gender IN ('WOMAN', 'MAN', 'NON_BINARY', 'PREFER_NOT_TO_SAY'));

ALTER TABLE ad_campaigns
  ADD COLUMN IF NOT EXISTS target_gender VARCHAR(20) NOT NULL DEFAULT 'ALL',
  ADD COLUMN IF NOT EXISTS target_age_ranges TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS target_country_codes CHAR(2)[] NOT NULL DEFAULT ARRAY[]::CHAR(2)[];

ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_target_gender_check;
ALTER TABLE ad_campaigns ADD CONSTRAINT ad_campaigns_target_gender_check
  CHECK (target_gender IN ('ALL', 'WOMAN', 'MAN', 'NON_BINARY'));
ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_target_age_ranges_check;
ALTER TABLE ad_campaigns ADD CONSTRAINT ad_campaigns_target_age_ranges_check
  CHECK (target_age_ranges <@ ARRAY['18-24', '25-34', '35-44', '45+']::TEXT[]);

ALTER TABLE ad_impressions
  ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_position_seconds INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_progress_at TIMESTAMPTZ;

ALTER TABLE viewer_location_regions
  ADD COLUMN IF NOT EXISTS country_code CHAR(2);

CREATE INDEX IF NOT EXISTS ad_campaigns_target_gender_idx ON ad_campaigns(target_gender);
CREATE INDEX IF NOT EXISTS ad_impressions_qualified_campaign_idx ON ad_impressions(campaign_id, qualified_at DESC)
  WHERE qualified_at IS NOT NULL;
