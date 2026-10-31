-- ClipPilot — Row Level Security.
-- Principle: users read their own rows; they write only harmless columns
-- of their own content. Credits, roles, subscriptions, jobs and exports are
-- read-only for clients and mutated by SECURITY DEFINER functions or the
-- service role (trusted server code / workers).

alter table public.app_config enable row level security;
alter table public.plans enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.credit_balances enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.projects enable row level security;
alter table public.videos enable row level security;
alter table public.transcripts enable row level security;
alter table public.clips enable row level security;
alter table public.clip_edits enable row level security;
alter table public.exports enable row level security;
alter table public.video_jobs enable row level security;
alter table public.usage_logs enable row level security;
alter table public.admin_logs enable row level security;
alter table public.feature_flags enable row level security;
alter table public.rate_limits enable row level security;
alter table public.stripe_events enable row level security;

-- Start from zero privileges for client roles, then grant precisely.
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;

-- plans: public catalogue
grant select on public.plans to anon, authenticated;
create policy plans_read on public.plans for select to anon, authenticated
  using (is_active or public.is_admin());

-- feature flags: readable by signed-in users (UI gating)
grant select on public.feature_flags to authenticated;
create policy flags_read on public.feature_flags for select to authenticated using (true);

-- profiles
grant select on public.profiles to authenticated;
grant update (full_name, onboarding_completed) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- read-only billing / role tables
grant select on public.user_roles, public.subscriptions, public.credit_balances,
  public.credit_transactions, public.usage_logs to authenticated;
create policy roles_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy subs_read on public.subscriptions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy balances_read on public.credit_balances for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy tx_read on public.credit_transactions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy usage_read on public.usage_logs for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- projects: full ownership
grant select, insert, delete on public.projects to authenticated;
grant update (name) on public.projects to authenticated;
create policy projects_read on public.projects for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy projects_insert on public.projects for insert to authenticated
  with check (user_id = auth.uid());
create policy projects_update on public.projects for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy projects_delete on public.projects for delete to authenticated
  using (user_id = auth.uid());

-- videos / transcripts / jobs / exports: read-only for owners
grant select on public.videos, public.transcripts, public.video_jobs, public.exports to authenticated;
create policy videos_read on public.videos for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy transcripts_read on public.transcripts for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy jobs_read on public.video_jobs for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy exports_read on public.exports for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- clips: owners may rename
grant select on public.clips to authenticated;
grant update (title) on public.clips to authenticated;
create policy clips_read on public.clips for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy clips_update on public.clips for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- clip edits: owners edit their own clips' settings
grant select, insert on public.clip_edits to authenticated;
grant update (start_seconds, end_seconds, aspect_ratio, resolution, template,
  subtitle_style, subtitle_words, subtitles_enabled, crop) on public.clip_edits to authenticated;
create policy edits_read on public.clip_edits for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy edits_insert on public.clip_edits for insert to authenticated
  with check (user_id = auth.uid()
    and exists (select 1 from public.clips c where c.id = clip_id and c.user_id = auth.uid()));
create policy edits_update on public.clip_edits for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- admin logs
grant select on public.admin_logs to authenticated;
create policy admin_logs_read on public.admin_logs for select to authenticated
  using (public.is_admin());

-- app_config & rate_limits: no client access at all (RLS on, no policy).

-- Realtime: let clients subscribe to their job progress.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.video_jobs;
  end if;
end $$;
