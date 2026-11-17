ALTER TABLE users
  ADD COLUMN IF NOT EXISTS coin_balance INTEGER NOT NULL DEFAULT 0
    CHECK (coin_balance >= 0);

ALTER TABLE episodes
  ADD COLUMN IF NOT EXISTS subtitle_languages TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS dubbing_languages TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE IF NOT EXISTS coin_topups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack_code VARCHAR(20) NOT NULL,
  coin_amount INTEGER NOT NULL CHECK (coin_amount > 0),
  amount_sen INTEGER NOT NULL CHECK (amount_sen > 0),
  currency CHAR(3) NOT NULL DEFAULT 'MYR',
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'FAILED')),
  stripe_session_id VARCHAR(150) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS episode_coin_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  coin_amount INTEGER NOT NULL CHECK (coin_amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, episode_id)
);

CREATE INDEX IF NOT EXISTS episode_coin_purchases_user_idx
  ON episode_coin_purchases(user_id, created_at DESC);
