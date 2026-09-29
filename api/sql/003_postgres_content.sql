CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('VIEWER', 'CREATOR', 'ADVERTISER', 'ADMIN')) DEFAULT 'VIEWER',
  is_vip BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('MOVIE', 'SERIES')),
  description TEXT NOT NULL,
  poster_url TEXT NOT NULL,
  rating VARCHAR(20) NOT NULL DEFAULT 'P13',
  genre VARCHAR(100) NOT NULL,
  category VARCHAR(100) NOT NULL,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  is_exclusive_vip BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED')) DEFAULT 'DRAFT',
  origin geography(Point, 4326),
  available_regions geography(MultiPolygon, 4326),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_status_idx ON content(status, created_at DESC);
CREATE INDEX IF NOT EXISTS content_origin_gist_idx ON content USING GIST(origin);

CREATE TABLE IF NOT EXISTS episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  title VARCHAR(255) NOT NULL,
  duration_seconds INTEGER NOT NULL,
  hls_manifest_url TEXT NOT NULL,
  is_free_preview BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(content_id, episode_number)
);

CREATE TABLE IF NOT EXISTS ad_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_name VARCHAR(150) NOT NULL,
  creative_video_url TEXT NOT NULL,
  cpm_rate NUMERIC(10,2) NOT NULL,
  total_budget NUMERIC(12,2) NOT NULL,
  remaining_budget NUMERIC(12,2) NOT NULL,
  target_tier VARCHAR(10) NOT NULL DEFAULT 'FREE',
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watch_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  episode_id UUID NOT NULL REFERENCES episodes(id),
  watch_seconds INTEGER NOT NULL,
  device_ip INET NOT NULL,
  session_uid VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES users(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  processed_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  admin_user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
