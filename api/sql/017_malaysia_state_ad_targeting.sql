ALTER TABLE ad_campaigns
  ADD COLUMN IF NOT EXISTS target_malaysia_states TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE viewer_location_regions
  ADD COLUMN IF NOT EXISTS region_code CHAR(2);

UPDATE ad_campaigns SET target_gender = 'ALL' WHERE target_gender = 'NON_BINARY';
ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_target_gender_check;
ALTER TABLE ad_campaigns ADD CONSTRAINT ad_campaigns_target_gender_check
  CHECK (target_gender IN ('ALL', 'WOMAN', 'MAN'));

ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_target_malaysia_states_check;
ALTER TABLE ad_campaigns ADD CONSTRAINT ad_campaigns_target_malaysia_states_check
  CHECK (target_malaysia_states <@ ARRAY['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16']::TEXT[]);

CREATE INDEX IF NOT EXISTS ad_campaigns_target_malaysia_states_idx
  ON ad_campaigns USING GIN (target_malaysia_states);
