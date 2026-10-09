CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('CREATOR', 'ADVERTISER')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

INSERT INTO user_roles (user_id, role)
SELECT id, role FROM users WHERE role IN ('CREATOR', 'ADVERTISER')
ON CONFLICT (user_id, role) DO NOTHING;