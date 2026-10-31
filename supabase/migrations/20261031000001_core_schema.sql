-- ClipPilot — core schema
-- All tables live in `public`, protected by RLS (see 0003). Writes to
-- billing/credit/role tables are only possible through SECURITY DEFINER
-- functions or the service role used by trusted server code.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('OWNER', 'ADMIN', 'USER');
create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
create type public.job_type as enum ('process_video', 'render_clip', 'cleanup');
create type public.video_status as enum ('uploading', 'uploaded', 'processing', 'ready', 'failed', 'expired');
create type public.clip_status as enum ('pending', 'rendering', 'ready', 'failed');

-- ---------------------------------------------------------------------------
-- Generic updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Private configuration (never exposed through the API)
-- ---------------------------------------------------------------------------
create table public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Plans (configurable from the admin panel)
-- ---------------------------------------------------------------------------
create table public.plans (
  id text primary key check (id ~ '^[a-z0-9_-]{2,32}$'),
  name text not null,
  description text not null default '',
  price_cents integer not null default 0 check (price_cents >= 0),
  currency text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  monthly_minutes integer not null check (monthly_minutes >= 0),
  monthly_clips integer not null check (monthly_clips >= 0),
  max_resolution integer not null default 720 check (max_resolution in (720, 1080)),
  max_upload_mb integer not null default 500 check (max_upload_mb > 0),
  max_video_minutes integer not null default 60 check (max_video_minutes > 0),
  watermark boolean not null default true,
  priority integer not null default 0,
  features jsonb not null default '{}'::jsonb,
  stripe_price_id text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger plans_touch before update on public.plans
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Profiles & roles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '' check (char_length(full_name) <= 120),
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_email_idx on public.profiles (lower(email));
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create table public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'USER',
  granted_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index user_roles_role_idx on public.user_roles (role);

-- ---------------------------------------------------------------------------
-- Subscriptions & credits
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  plan_id text not null references public.plans (id),
  status text not null default 'active'
    check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'unpaid')),
  stripe_customer_id text,
  stripe_subscription_id text unique,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_customer_idx on public.subscriptions (stripe_customer_id);
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

create table public.credit_balances (
  user_id uuid primary key references auth.users (id) on delete cascade,
  period_start timestamptz not null default date_trunc('day', now()),
  period_end timestamptz not null default date_trunc('day', now()) + interval '1 month',
  minutes_used numeric(12, 2) not null default 0 check (minutes_used >= 0),
  clips_used integer not null default 0 check (clips_used >= 0),
  bonus_minutes integer not null default 0 check (bonus_minutes >= 0),
  bonus_clips integer not null default 0 check (bonus_clips >= 0),
  updated_at timestamptz not null default now()
);
create trigger credit_balances_touch before update on public.credit_balances
  for each row execute function public.touch_updated_at();

create table public.credit_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in (
    'minutes_debit', 'minutes_refund', 'clips_debit', 'clips_refund',
    'admin_grant', 'period_reset', 'plan_change')),
  minutes numeric(12, 2) not null default 0,
  clips integer not null default 0,
  unlimited boolean not null default false,
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index credit_transactions_user_idx on public.credit_transactions (user_id, created_at desc);
create unique index credit_transactions_idem_idx
  on public.credit_transactions (user_id, kind, reference_type, reference_id)
  where reference_id is not null and kind in ('minutes_debit', 'clips_debit', 'minutes_refund', 'clips_refund');

-- ---------------------------------------------------------------------------
-- Content
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user_idx on public.projects (user_id, created_at desc);
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  original_filename text not null check (char_length(original_filename) <= 255),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('video/mp4', 'video/quicktime', 'video/webm')),
  size_bytes bigint not null check (size_bytes > 0),
  declared_duration_seconds numeric(10, 2),
  duration_seconds numeric(10, 2),
  width integer,
  height integer,
  status public.video_status not null default 'uploading',
  error text,
  settings jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index videos_user_idx on public.videos (user_id, created_at desc);
create index videos_project_idx on public.videos (project_id);
create index videos_status_idx on public.videos (status);
create index videos_expires_idx on public.videos (expires_at) where expires_at is not null;
create trigger videos_touch before update on public.videos
  for each row execute function public.touch_updated_at();

create table public.transcripts (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null unique references public.videos (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  language text,
  model text,
  full_text text not null default '',
  segments jsonb not null default '[]'::jsonb,
  words jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index transcripts_user_idx on public.transcripts (user_id);

create table public.clips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  start_seconds numeric(10, 3) not null check (start_seconds >= 0),
  end_seconds numeric(10, 3) not null,
  duration_seconds numeric(10, 3) generated always as (end_seconds - start_seconds) stored,
  transcript text not null default '',
  reason text not null default '',
  hook_type text,
  hook_text text,
  virality_score integer check (virality_score between 0 and 100),
  score_breakdown jsonb not null default '{}'::jsonb,
  rank integer not null default 0,
  status public.clip_status not null default 'pending',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_seconds > start_seconds)
);
create index clips_user_idx on public.clips (user_id, created_at desc);
create index clips_video_idx on public.clips (video_id, rank);
create index clips_project_idx on public.clips (project_id);
create index clips_score_idx on public.clips (user_id, virality_score desc);
create trigger clips_touch before update on public.clips
  for each row execute function public.touch_updated_at();

create table public.clip_edits (
  clip_id uuid primary key references public.clips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  start_seconds numeric(10, 3),
  end_seconds numeric(10, 3),
  aspect_ratio text not null default '9:16' check (aspect_ratio in ('9:16', '1:1', '16:9')),
  resolution integer not null default 720 check (resolution in (720, 1080)),
  template text not null default 'bold',
  subtitle_style jsonb not null default '{}'::jsonb,
  subtitle_words jsonb,
  subtitles_enabled boolean not null default true,
  crop jsonb not null default '{"mode": "auto"}'::jsonb,
  updated_at timestamptz not null default now(),
  check (start_seconds is null or end_seconds is null or end_seconds > start_seconds)
);
create index clip_edits_user_idx on public.clip_edits (user_id);
create trigger clip_edits_touch before update on public.clip_edits
  for each row execute function public.touch_updated_at();

create table public.exports (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null unique,
  aspect_ratio text not null,
  resolution integer not null,
  width integer not null,
  height integer not null,
  size_bytes bigint not null check (size_bytes > 0),
  duration_seconds numeric(10, 3) not null,
  watermark boolean not null,
  is_current boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index exports_clip_idx on public.exports (clip_id, created_at desc);
create index exports_user_idx on public.exports (user_id);
create index exports_expires_idx on public.exports (expires_at) where expires_at is not null;

-- ---------------------------------------------------------------------------
-- Job queue
-- ---------------------------------------------------------------------------
create table public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  video_id uuid references public.videos (id) on delete cascade,
  clip_id uuid references public.clips (id) on delete cascade,
  type public.job_type not null,
  status public.job_status not null default 'queued',
  priority integer not null default 0,
  progress integer not null default 0 check (progress between 0 and 100),
  stage text not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  run_after timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  heartbeat_at timestamptz,
  error text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index video_jobs_queue_idx on public.video_jobs (priority desc, created_at)
  where status = 'queued';
create index video_jobs_running_idx on public.video_jobs (heartbeat_at) where status = 'running';
create index video_jobs_user_idx on public.video_jobs (user_id, created_at desc);
create index video_jobs_video_idx on public.video_jobs (video_id);
create index video_jobs_clip_idx on public.video_jobs (clip_id);

-- ---------------------------------------------------------------------------
-- Observability
-- ---------------------------------------------------------------------------
create table public.usage_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade,
  event text not null,
  quantity numeric(12, 3) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index usage_logs_user_idx on public.usage_logs (user_id, created_at desc);
create index usage_logs_event_idx on public.usage_logs (event, created_at desc);

create table public.admin_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_user_id uuid references auth.users (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_logs_created_idx on public.admin_logs (created_at desc);

create table public.feature_flags (
  key text primary key check (key ~ '^[a-z0-9_]{2,64}$'),
  enabled boolean not null default true,
  description text not null default '',
  experimental boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger feature_flags_touch before update on public.feature_flags
  for each row execute function public.touch_updated_at();

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);

-- Processed Stripe webhook events (idempotency).
create table public.stripe_events (
  id text primary key,
  type text not null,
  created_at timestamptz not null default now()
);
