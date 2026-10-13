ALTER TABLE ad_campaigns
  DROP CONSTRAINT IF EXISTS ad_campaigns_target_tier_check;

UPDATE ad_campaigns
SET target_tier = 'FREE'
WHERE target_tier = 'VIP';

ALTER TABLE ad_campaigns
  ADD CONSTRAINT ad_campaigns_target_tier_check
    CHECK (target_tier IN ('ALL', 'FREE'));
