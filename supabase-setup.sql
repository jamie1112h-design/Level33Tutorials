-- Level 33 Tutorials — Supabase Setup
-- Run this entire script in the Supabase SQL Editor (one paste, one click)

-- Create the subscribers table
create table subscribers (
  id                     uuid primary key default gen_random_uuid(),
  email                  text unique not null,
  access_code            text unique not null,
  stripe_customer_id     text,
  stripe_subscription_id text,
  status                 text default 'active',
  created_at             timestamptz default now(),
  expires_at             timestamptz
);

-- Index for fast access code lookups (every course generation hits this)
create index idx_access_code on subscribers (access_code);

-- Index for webhook lookups by subscription ID
create index idx_subscription_id on subscribers (stripe_subscription_id);

-- Enable Row Level Security (blocks all public access by default)
alter table subscribers enable row level security;

-- No public policies needed — your service role key bypasses RLS entirely
-- This means only your serverless functions can read/write this table
