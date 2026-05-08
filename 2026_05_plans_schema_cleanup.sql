-- ============================================================
-- 2026_05_plans_schema_cleanup.sql
-- ============================================================
-- Cleans up the plans table to match what index_v2.html (live app) expects.
--
-- Drops:
--   approval_token, approved_at, sent_at, client_notes  -- old approval email flow
--   phase                                               -- old multi-phase workflow
--   topic_round_id                                      -- old topic rounds feature
--
-- Adds:
--   updated_at timestamptz default now()                -- live app references it
--   plans_set_updated_at trigger                        -- auto-update on row change
--
-- Approval flow will be rebuilt in v3 of the tool.
-- ============================================================

begin;

alter table plans drop column if exists approval_token;
alter table plans drop column if exists approved_at;
alter table plans drop column if exists sent_at;
alter table plans drop column if exists client_notes;
alter table plans drop column if exists phase;
alter table plans drop column if exists topic_round_id;

alter table plans add column if not exists updated_at timestamptz default now();

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists plans_set_updated_at on plans;
create trigger plans_set_updated_at
  before update on plans
  for each row
  execute function set_updated_at();

commit;
