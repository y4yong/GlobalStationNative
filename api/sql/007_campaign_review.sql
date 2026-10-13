ALTER TABLE ad_campaigns
  DROP CONSTRAINT IF EXISTS ad_campaigns_status_check;

UPDATE ad_campaigns
SET status = 'PENDING_REVIEW'
WHERE status = 'PAUSED';

ALTER TABLE ad_campaigns
  ALTER COLUMN status SET DEFAULT 'PENDING_REVIEW',
  ADD CONSTRAINT ad_campaigns_status_check
    CHECK (status IN ('PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'REJECTED', 'COMPLETED'));
