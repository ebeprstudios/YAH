-- =============================================================
-- YAH! OAuth + Direct Social Integration — Schema Migration
-- Run AFTER 2026_metricool.sql (or as a fresh setup — handles both)
-- =============================================================

-- 1. Rename metricool_posts → social_posts (platform-agnostic name)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'metricool_posts') THEN
    ALTER TABLE metricool_posts RENAME TO social_posts;
  END IF;
END $$;

-- 2. If first run (no prior migration), create social_posts from scratch
CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_id TEXT,
  network TEXT NOT NULL,
  post_type TEXT,
  caption TEXT,
  permalink TEXT,
  thumbnail_url TEXT,
  published_at TIMESTAMPTZ,
  reach INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  followers_at_time INTEGER,
  pillar TEXT,
  source TEXT DEFAULT 'api',
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, network, external_id)
);

CREATE INDEX IF NOT EXISTS idx_social_posts_client_published
  ON social_posts(client_id, published_at DESC);

-- 3. Update performance_scores FK reference (was post_id → metricool_posts)
-- Postgres preserves the FK because it points at OID, not name. No-op if migration #1 ran.

-- 4. Update repost_schedule FK reference — same story.

-- 5. Extend client_integrations for OAuth
ALTER TABLE client_integrations
  ADD COLUMN IF NOT EXISTS access_token TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS platform_user_id TEXT,
  ADD COLUMN IF NOT EXISTS platform_username TEXT,
  ADD COLUMN IF NOT EXISTS scope TEXT,
  ADD COLUMN IF NOT EXISTS last_pulled_at TIMESTAMPTZ;

-- For fresh installs (no prior migration), create the table.
CREATE TABLE IF NOT EXISTS client_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  platform_user_id TEXT,
  platform_username TEXT,
  scope TEXT,
  last_pulled_at TIMESTAMPTZ,
  api_key TEXT,
  account_blog_id TEXT,
  user_id TEXT,
  plan_tier TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, provider)
);

-- 6. OAuth state tracking (CSRF protection + flow context)
CREATE TABLE IF NOT EXISTS oauth_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_token TEXT NOT NULL UNIQUE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,            -- 'instagram' | 'tiktok'
  used BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '10 minutes',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_state_token ON oauth_state(state_token);

-- 7. Performance scores + repost schedule (in case fresh install)
CREATE TABLE IF NOT EXISTS performance_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL UNIQUE REFERENCES social_posts(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  composite_score NUMERIC(5,2),
  reach_percentile NUMERIC(5,2),
  save_rate NUMERIC(7,4),
  share_rate NUMERIC(7,4),
  engagement_rate NUMERIC(7,4),
  tier TEXT,
  computed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_performance_scores_client_score
  ON performance_scores(client_id, composite_score DESC);

CREATE TABLE IF NOT EXISTS repost_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source_post_id UUID REFERENCES social_posts(id) ON DELETE SET NULL,
  scheduled_for DATE,
  status TEXT DEFAULT 'queued',
  notes TEXT,
  pushed_to_metricool_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategy_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_start DATE,
  period_end DATE,
  proven_themes TEXT,
  brief_content TEXT,
  raw_metrics JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- RLS — match existing YAH pattern (permissive anon for MVP)
-- =============================================================

ALTER TABLE social_posts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_integrations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_scores    ENABLE ROW LEVEL SECURITY;
ALTER TABLE repost_schedule       ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_briefs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_state           ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY anon_all ON social_posts        FOR ALL TO anon USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY anon_all ON client_integrations FOR ALL TO anon USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY anon_all ON performance_scores  FOR ALL TO anon USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY anon_all ON repost_schedule     FOR ALL TO anon USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY anon_all ON strategy_briefs     FOR ALL TO anon USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY anon_all ON oauth_state         FOR ALL TO anon USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
