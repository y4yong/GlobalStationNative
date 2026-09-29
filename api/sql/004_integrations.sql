ALTER TABLE payment_transactions
  DROP CONSTRAINT IF EXISTS payment_transactions_provider_check;

ALTER TABLE payment_transactions
  ADD CONSTRAINT payment_transactions_provider_check
  CHECK (provider IN ('FPX', 'CARD', 'EWALLET', 'STRIPE', 'BILLPLZ', 'MANUAL'));

ALTER TABLE ad_campaigns
  ADD COLUMN IF NOT EXISTS click_through_url TEXT;