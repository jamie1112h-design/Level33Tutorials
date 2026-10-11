-- PrecisionSteps Tutorials – supabase-setup.sql (version 2)
-- Matches the LIVE database as read on 2026-10-11 (project qtnnaeozugmcjlwrntwn, ca-central-1).
-- Replaces the older script, which was missing subscribers.stripe_session_id, subscribers.trial_ends_at,
-- and the sessions and trial_users tables.
-- Safe to run on an existing database: every statement uses IF NOT EXISTS.
-- Access model today: the Netlify functions use the service key, which bypasses row-level security.
-- The three tables have RLS on and NO policies, so the public (anon) and signed-in (authenticated)
-- roles can read nothing. Stage 2 will add real policies.

-- ── Subscribers (billing record, one row per paying email) ────────────────────
create table if not exists public.subscribers (
  id                      uuid primary key default gen_random_uuid(),
  email                   text not null unique,
  access_code             text not null unique,
  stripe_customer_id      text,
  stripe_subscription_id  text,
  status                  text default 'active',
  created_at              timestamptz default now(),
  expires_at              timestamptz,
  stripe_session_id       text,
  trial_ends_at           timestamptz
);
create index if not exists idx_access_code     on public.subscribers (access_code);
create index if not exists idx_subscription_id on public.subscribers (stripe_subscription_id);
create index if not exists idx_session_id      on public.subscribers (stripe_session_id);
alter table public.subscribers enable row level security;

-- ── Sessions (one row per generated course; metadata and, later, scores) ──────
create table if not exists public.sessions (
  id             uuid primary key default gen_random_uuid(),
  subscriber_id  uuid references public.subscribers(id) on delete set null,
  subject        text not null,
  frame_count    integer not null,
  edu_level      text not null default '',
  learn_level    text not null default 'intermediate',
  language       text not null default 'en',
  completed      boolean default false,
  frame_scores   jsonb,
  score_pct      numeric,
  created_at     timestamptz default now()
);
create index if not exists idx_sessions_subscriber on public.sessions (subscriber_id);
create index if not exists idx_sessions_created    on public.sessions (created_at);
alter table public.sessions enable row level security;

-- ── Trial users (server-side free-trial counter, one row per email) ───────────
create table if not exists public.trial_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  lessons_used  integer not null default 0,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists trial_users_email_idx on public.trial_users (email);
alter table public.trial_users enable row level security;

-- ── RECOMMENDED, NOT YET APPLIED to the live database ─────────────────────────
-- By default Supabase also grants the anon and authenticated roles full table privileges. RLS with
-- no policies already blocks them; revoking the grants adds a second lock. The service key is
-- unaffected. Run only after Jamie approves.
-- revoke all on public.subscribers, public.sessions, public.trial_users from anon, authenticated;
