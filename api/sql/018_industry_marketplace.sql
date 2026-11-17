CREATE TABLE IF NOT EXISTS industry_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  organization VARCHAR(160) NOT NULL DEFAULT '',
  industry_role VARCHAR(100) NOT NULL,
  bio VARCHAR(1000) NOT NULL DEFAULT '',
  region VARCHAR(80) NOT NULL DEFAULT 'Malaysia',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS industry_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message VARCHAR(500) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (requester_id <> recipient_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS industry_connections_pair_idx
  ON industry_connections (LEAST(requester_id, recipient_id), GREATEST(requester_id, recipient_id))
  WHERE status <> 'CANCELLED';

CREATE INDEX IF NOT EXISTS industry_connections_inbox_idx
  ON industry_connections (recipient_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS marketplace_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  summary VARCHAR(3000) NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('PROJECT', 'SCRIPT', 'IP', 'TALENT')),
  format VARCHAR(16) NOT NULL CHECK (format IN ('VERTICAL_SERIES', 'SHORT_FILM', 'FEATURE_FILM', 'OTHER')),
  category VARCHAR(100) NOT NULL DEFAULT 'Drama',
  stage VARCHAR(24) NOT NULL CHECK (stage IN ('IDEA', 'SCRIPT', 'DEVELOPMENT', 'PRODUCTION', 'POST_PRODUCTION')),
  seeking TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  regions TEXT[] NOT NULL DEFAULT ARRAY['MY']::TEXT[],
  subtitle_languages TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  dubbing_languages TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  investment_target NUMERIC(12,2) CHECK (investment_target IS NULL OR investment_target > 0),
  status VARCHAR(16) NOT NULL DEFAULT 'IN_REVIEW'
    CHECK (status IN ('IN_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_projects_status_created_idx
  ON marketplace_projects (status, created_at DESC);
CREATE INDEX IF NOT EXISTS marketplace_projects_creator_idx
  ON marketplace_projects (creator_id, created_at DESC);

CREATE TABLE IF NOT EXISTS marketplace_interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES marketplace_projects(id) ON DELETE CASCADE,
  investor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) CHECK (amount IS NULL OR amount > 0),
  message VARCHAR(1000) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACKNOWLEDGED', 'DECLINED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, investor_id)
);

CREATE INDEX IF NOT EXISTS marketplace_interests_project_idx
  ON marketplace_interests (project_id, created_at DESC);
