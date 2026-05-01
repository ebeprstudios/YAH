-- =============================================================
-- YAH! Metricool Integration — Schema Migration
-- Run this in Supabase SQL Editor
-- =============================================================

-- 1. Per-client integration credentials (Metricool, future: Resend, Notion, etc.)
CREATE TABLE IF NOT EXISTS client_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,                      -- 'metricool'
  api_key TEXT,                                -- Metricool User Token
  account_blog_id TEXT,                        -- Metricool blog/account ID
  user_id TEXT,                                -- Metricool user ID
  plan_tier TEXT DEFAULT 'starter',            -- 'starter' | 'advanced'
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, provider)
);

-- 2. Posts pulled from Metricool (API or CSV)
CREATE TABLE IF NOT EXISTS metricool_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_id TEXT,                            -- Metricool post ID, or 'csv_<hash>'
  network TEXT NOT NULL,                       -- 'instagram' | 'facebook' | 'tiktok' | etc.
  post_type TEXT,                              -- 'reel' | 'carousel' | 'image' | 'video' | 'story'
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
  pillar TEXT,                                 -- Tagged pillar (manual or inferred)
  source TEXT DEFAULT 'api',                   -- 'api' | 'csv'
  raw_data JSONB,                              -- Original payload for debugging
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, network, external_id)
);

CREATE INDEX IF NOT EXISTS idx_metricool_posts_client_published
  ON metricool_posts(client_id, published_at DESC);

-- 3. Computed performance scores (0-100 composite)
CREATE TABLE IF NOT EXISTS performance_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL UNIQUE REFERENCES metricool_posts(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  composite_score NUMERIC(5,2),                -- 0-100
  reach_percentile NUMERIC(5,2),               -- 0-100, vs other posts from this client
  save_rate NUMERIC(7,4),                      -- saves / reach
  share_rate NUMERIC(7,4),                     -- shares / reach
  engagement_rate NUMERIC(7,4),                -- (likes+comments+saves+shares) / reach
  tier TEXT,                                   -- 'top' | 'mid' | 'low'
  computed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_performance_scores_client_score
  ON performance_scores(client_id, composite_score DESC);

-- 4. Reposts queued from proven content
CREATE TABLE IF NOT EXISTS repost_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source_post_id UUID REFERENCES metricool_posts(id) ON DELETE SET NULL,
  scheduled_for DATE,
  status TEXT DEFAULT 'queued',                -- 'queued' | 'pushed' | 'published' | 'cancelled'
  notes TEXT,
  pushed_to_metricool_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Strategy briefs (Claude-generated 90-day analyses)
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
-- RLS — match existing YAH pattern (permissive anon for MVP).
-- Lock down when Supabase Auth is added.
-- =============================================================

ALTER TABLE client_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE metricool_posts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_scores  ENABLE ROW LEVEL SECURITY;
ALTER TABLE repost_schedule     ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_briefs     ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY anon_all ON client_integrations FOR ALL TO anon USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY anon_all ON metricool_posts FOR ALL TO anon USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY anon_all ON performance_scores FOR ALL TO anon USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY anon_all ON repost_schedule FOR ALL TO anon USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY anon_all ON strategy_briefs FOR ALL TO anon USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
