ALTER TABLE watch_logs
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
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

CREATE TABLE IF NOT EXISTS ad_clicks (
  impression_id BIGINT PRIMARY KEY REFERENCES ad_impressions(id) ON DELETE CASCADE,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS end_reason VARCHAR(30);

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS failure_reason VARCHAR(30);

CREATE TABLE IF NOT EXISTS viewer_activity (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_uid VARCHAR(100) NOT NULL,
  activity_date DATE NOT NULL DEFAULT current_date,
  watch_seconds INTEGER NOT NULL DEFAULT 0 CHECK (watch_seconds >= 0),
  device_type VARCHAR(20),
  country_code CHAR(2),
  PRIMARY KEY (user_id, session_uid, activity_date)
);

CREATE INDEX IF NOT EXISTS watch_logs_user_created_idx ON watch_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS watch_logs_last_seen_idx ON watch_logs(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS watch_logs_episode_session_idx ON watch_logs(episode_id, session_uid);
CREATE INDEX IF NOT EXISTS watch_logs_country_created_idx ON watch_logs(country_code, created_at DESC);
CREATE INDEX IF NOT EXISTS viewer_activity_date_user_idx ON viewer_activity(activity_date, user_id);
CREATE INDEX IF NOT EXISTS viewer_activity_country_idx ON viewer_activity(country_code, activity_date);
CREATE INDEX IF NOT EXISTS ad_impressions_campaign_created_idx ON ad_impressions(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ad_impressions_country_created_idx ON ad_impressions(country_code, created_at DESC);
CREATE INDEX IF NOT EXISTS subscriptions_status_renews_idx ON subscriptions(status, renews_at);
CREATE INDEX IF NOT EXISTS payment_transactions_status_created_idx ON payment_transactions(status, created_at DESC);
