-- Global Station complete PostgreSQL + PostGIS schema and development seed.
-- Run against an empty database named globalstation with:
--   psql -U postgres -d globalstation -f complete_globalstation.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'VIEWER' CHECK (role IN ('VIEWER', 'CREATOR', 'ADVERTISER', 'ADMIN')),
  is_vip BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('CREATOR', 'ADVERTISER')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);
INSERT INTO user_roles (user_id, role)
SELECT id, role FROM users WHERE role IN ('CREATOR', 'ADVERTISER')
ON CONFLICT (user_id, role) DO NOTHING;

CREATE TABLE IF NOT EXISTS device_fingerprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  fingerprint_hash VARCHAR(255) NOT NULL,
  platform VARCHAR(30) NOT NULL,
  attestation_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (attestation_status IN ('PENDING', 'TRUSTED', 'BLOCKED')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, fingerprint_hash)
);

CREATE TABLE IF NOT EXISTS content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('MOVIE', 'SERIES')),
  description TEXT NOT NULL,
  poster_url TEXT NOT NULL,
  backdrop_url TEXT,
  rating VARCHAR(20) NOT NULL DEFAULT 'P13',
  genre TEXT NOT NULL,
  category VARCHAR(100) NOT NULL,
  language_code VARCHAR(10) NOT NULL DEFAULT 'ms',
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  is_exclusive_vip BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED')),
  origin geography(Point, 4326),
  available_regions geography(MultiPolygon, 4326),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP VIEW IF EXISTS published_catalog;
ALTER TABLE content ALTER COLUMN genre TYPE TEXT;
ALTER TABLE content ADD COLUMN IF NOT EXISTS origin geography(Point, 4326);

CREATE TABLE IF NOT EXISTS content_rights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  territory_code VARCHAR(10) NOT NULL,
  valid_from DATE NOT NULL,
  valid_until DATE,
  rights_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (rights_status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
  UNIQUE(content_id, territory_code)
);

CREATE TABLE IF NOT EXISTS episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL CHECK (episode_number > 0),
  title VARCHAR(255) NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  hls_manifest_url TEXT NOT NULL,
  dash_manifest_url TEXT,
  is_free_preview BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(content_id, episode_number)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code VARCHAR(30) NOT NULL CHECK (plan_code IN ('FREE', 'VIP_MONTHLY', 'VIP_YEARLY')),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  renews_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  provider VARCHAR(30) NOT NULL CHECK (provider IN ('FPX', 'CARD', 'EWALLET', 'STRIPE', 'MANUAL')),
  provider_reference VARCHAR(150) UNIQUE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'MYR',
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS creator_revenue_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES users(id),
  content_id UUID REFERENCES content(id) ON DELETE SET NULL,
  source_type VARCHAR(30) NOT NULL CHECK (source_type IN ('SUBSCRIPTION', 'ADVERTISING', 'TIP', 'ADJUSTMENT')),
  gross_amount NUMERIC(12,2) NOT NULL,
  creator_share NUMERIC(12,2) NOT NULL,
  platform_share NUMERIC(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'MYR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES users(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'PAID')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  processed_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ad_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advertiser_id UUID REFERENCES users(id) ON DELETE SET NULL,
  campaign_name VARCHAR(150) NOT NULL,
  creative_video_url TEXT NOT NULL,
  cpm_rate NUMERIC(10,2) NOT NULL CHECK (cpm_rate >= 0),
  total_budget NUMERIC(12,2) NOT NULL CHECK (total_budget >= 0),
  remaining_budget NUMERIC(12,2) NOT NULL CHECK (remaining_budget >= 0),
  target_tier VARCHAR(10) NOT NULL DEFAULT 'FREE' CHECK (target_tier IN ('ALL', 'FREE')),
  target_regions geography(MultiPolygon, 4326),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'REJECTED', 'COMPLETED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS click_through_url TEXT;

CREATE TABLE IF NOT EXISTS ad_impressions (
  id BIGSERIAL PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  content_id UUID REFERENCES content(id) ON DELETE SET NULL,
  device_ip INET NOT NULL,
  watched_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watch_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  watch_seconds INTEGER NOT NULL CHECK (watch_seconds >= 0),
  device_ip INET NOT NULL,
  session_uid VARCHAR(100) NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  location geography(Point, 4326),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  subject VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referral_code VARCHAR(30) NOT NULL,
  reward_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'QUALIFIED', 'PAID')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(referrer_id, referred_id)
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  admin_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_status_created_idx ON content(status, created_at DESC);
CREATE INDEX IF NOT EXISTS content_origin_gist_idx ON content USING GIST(origin);
CREATE INDEX IF NOT EXISTS episodes_content_idx ON episodes(content_id, episode_number);
CREATE INDEX IF NOT EXISTS watch_logs_created_idx ON watch_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON admin_audit_logs(entity_type, entity_id, created_at DESC);

CREATE OR REPLACE VIEW published_catalog AS
SELECT c.id, c.title, c.content_type, c.description, c.poster_url, c.backdrop_url, c.rating,
       c.genre, c.category, c.language_code, c.is_exclusive_vip, c.origin, c.available_regions,
       c.created_at, COUNT(e.id)::INTEGER AS episode_count
FROM content c
LEFT JOIN episodes e ON e.content_id = c.id
WHERE c.status = 'APPROVED'
GROUP BY c.id;

CREATE OR REPLACE VIEW creator_balances AS
SELECT u.id AS creator_id, u.name, u.email,
       COALESCE(SUM(l.creator_share), 0)::NUMERIC(12,2) AS earned,
       COALESCE((SELECT SUM(p.amount) FROM payout_requests p WHERE p.creator_id = u.id AND p.status IN ('APPROVED', 'PAID')), 0)::NUMERIC(12,2) AS withdrawn
FROM users u
LEFT JOIN creator_revenue_ledger l ON l.creator_id = u.id
WHERE u.role = 'CREATOR'
GROUP BY u.id;

-- Development seed users. Password for all accounts is ChangeMe123!.
INSERT INTO users (id, name, email, password_hash, role, is_vip)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Global Station Admin', 'admin@globalstation.local', crypt('ChangeMe123!', gen_salt('bf', 12)), 'ADMIN', TRUE),
  ('00000000-0000-0000-0000-000000000002', 'Aina Rahman', 'creator@globalstation.local', crypt('ChangeMe123!', gen_salt('bf', 12)), 'CREATOR', TRUE),
  ('00000000-0000-0000-0000-000000000003', 'Daniel Tan', 'advertiser@globalstation.local', crypt('ChangeMe123!', gen_salt('bf', 12)), 'ADVERTISER', FALSE),
  ('00000000-0000-0000-0000-000000000004', 'Maya Viewer', 'viewer@globalstation.local', crypt('ChangeMe123!', gen_salt('bf', 12)), 'VIEWER', TRUE)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, is_vip = EXCLUDED.is_vip;

INSERT INTO subscriptions (id, user_id, plan_code, status, started_at, renews_at)
VALUES ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'VIP_MONTHLY', 'ACTIVE', now() - interval '12 days', now() + interval '18 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO payment_transactions (id, user_id, subscription_id, provider, provider_reference, amount, currency, status)
VALUES ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', 'FPX', 'GS-SEED-FPX-001', 19.90, 'MYR', 'SUCCEEDED')
ON CONFLICT (id) DO NOTHING;

INSERT INTO payout_requests (id, creator_id, amount, status)
VALUES ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 350.00, 'PENDING')
ON CONFLICT (id) DO NOTHING;

INSERT INTO support_tickets (id, user_id, subject, description, priority, status)
VALUES ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'Playback stopped unexpectedly', 'The stream stopped after switching networks.', 'NORMAL', 'OPEN')
ON CONFLICT (id) DO NOTHING;

INSERT INTO admin_audit_logs (admin_user_id, action, entity_type, entity_id, metadata)
VALUES ('00000000-0000-0000-0000-000000000001', 'SEED_INITIALIZED', 'SYSTEM', 'globalstation', '{"source":"complete_globalstation.sql"}')
ON CONFLICT DO NOTHING;
  