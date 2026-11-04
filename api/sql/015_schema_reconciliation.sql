-- Bring databases created from older snapshots up to the columns used by the API.
-- Every operation is safe to rerun and preserves existing data.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS location_analytics_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE content
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS poster_horizontal_url TEXT;

ALTER TABLE ad_campaigns
  ADD COLUMN IF NOT EXISTS click_through_url TEXT;

ALTER TABLE watch_logs
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_position_seconds INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_position_seconds INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS device_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS country_code CHAR(2);

UPDATE watch_logs SET last_seen_at = created_at WHERE last_seen_at IS NULL;
ALTER TABLE watch_logs ALTER COLUMN last_seen_at SET DEFAULT now();
ALTER TABLE watch_logs ALTER COLUMN last_seen_at SET NOT NULL;

ALTER TABLE ad_impressions
  ADD COLUMN IF NOT EXISTS device_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS country_code CHAR(2),
  ADD COLUMN IF NOT EXISTS creative_duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS end_reason VARCHAR(30);

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS failure_reason VARCHAR(30);

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS code_id UUID REFERENCES engagement_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attribution_type VARCHAR(20) NOT NULL DEFAULT 'REFERRAL',
  ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ;
