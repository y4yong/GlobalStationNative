CREATE TABLE IF NOT EXISTS engagement_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL UNIQUE,
  code_type VARCHAR(20) NOT NULL CHECK (code_type IN ('REFERRAL', 'CAMPAIGN', 'INFLUENCER', 'PROMOTION')),
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reward_config JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(reward_config) = 'object'),
  max_redemptions INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);

DROP INDEX IF EXISTS engagement_codes_owner_referral_idx;
CREATE UNIQUE INDEX IF NOT EXISTS engagement_codes_owner_short_referral_idx
  ON engagement_codes(owner_id)
  WHERE code_type = 'REFERRAL' AND owner_id IS NOT NULL AND char_length(code) <= 9;

ALTER TABLE referrals
  ALTER COLUMN referrer_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS code_id UUID REFERENCES engagement_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attribution_type VARCHAR(20) NOT NULL DEFAULT 'REFERRAL',
  ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ;

ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_status_check;
UPDATE referrals SET status = CASE status
  WHEN 'PENDING' THEN 'SIGNED_UP'
  WHEN 'PAID' THEN 'REWARDED'
  ELSE status
END;
ALTER TABLE referrals ADD CONSTRAINT referrals_status_check
  CHECK (status IN ('SIGNED_UP', 'QUALIFIED', 'REWARDED', 'REJECTED'));
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_attribution_type_check;
ALTER TABLE referrals ADD CONSTRAINT referrals_attribution_type_check
  CHECK (attribution_type IN ('REFERRAL', 'CAMPAIGN', 'INFLUENCER', 'PROMOTION'));
CREATE UNIQUE INDEX IF NOT EXISTS referrals_code_referred_idx
  ON referrals(code_id, referred_id) WHERE code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS referrals_referrer_created_idx
  ON referrals(referrer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS engagement_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id UUID REFERENCES referrals(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_type VARCHAR(30) NOT NULL CHECK (reward_type IN ('VIP_DAYS', 'DISCOUNT_PERCENT', 'DISCOUNT_AMOUNT', 'CREDIT')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'GRANTED', 'REVOKED')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS engagement_rewards_user_created_idx
  ON engagement_rewards(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('IN_APP', 'PUSH', 'EMAIL', 'SMS', 'WHATSAPP')),
  audience VARCHAR(20) NOT NULL DEFAULT 'ALL' CHECK (audience IN ('ALL', 'FREE', 'VIP')),
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SENT', 'CANCELLED')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_campaigns_status_created_idx
  ON notification_campaigns(status, created_at DESC);

CREATE TABLE IF NOT EXISTS user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES notification_campaigns(id) ON DELETE SET NULL,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('IN_APP', 'PUSH', 'EMAIL', 'SMS', 'WHATSAPP')),
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED')),
  read_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, user_id)
);
CREATE INDEX IF NOT EXISTS user_notifications_inbox_idx
  ON user_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_notifications_unread_idx
  ON user_notifications(user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('IN_APP', 'PUSH', 'EMAIL', 'SMS', 'WHATSAPP')),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel)
);
