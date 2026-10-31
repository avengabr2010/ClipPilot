-- ClipPilot — business logic in the database.
-- Every function that changes credits, roles or the job queue is
-- SECURITY DEFINER with a pinned search_path and explicit EXECUTE grants.

-- ---------------------------------------------------------------------------
-- Roles helpers
-- ---------------------------------------------------------------------------
create or replace function public.role_of(p_user uuid)
returns public.app_role
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.user_roles where user_id = p_user), 'USER'::public.app_role);
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.role_of(auth.uid()) in ('OWNER', 'ADMIN');
$$;

create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.role_of(auth.uid()) = 'OWNER';
$$;

-- Guard: the OWNER role can only be written by the bootstrap path, which
-- sets a transaction-local flag. Nobody (not even an ADMIN through an RPC)
-- can promote themselves or someone else to OWNER, nor alter the owner row.
create or replace function public.guard_owner_role()
returns trigger language plpgsql as $$
declare
  v_allowed boolean := coalesce(current_setting('clippilot.owner_grant', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.role = 'OWNER' and not v_allowed then
      raise exception 'OWNER role cannot be self-assigned' using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' then
    if (new.role = 'OWNER' or old.role = 'OWNER') and new.role is distinct from old.role and not v_allowed then
      raise exception 'OWNER role can only be changed by the owner bootstrap procedure' using errcode = '42501';
    end if;
  elsif tg_op = 'DELETE' then
    if old.role = 'OWNER' and not v_allowed then
      raise exception 'OWNER role cannot be removed' using errcode = '42501';
    end if;
    return old;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger user_roles_guard
  before insert or update or delete on public.user_roles
  for each row execute function public.guard_owner_role();

-- ---------------------------------------------------------------------------
-- New user provisioning
-- ---------------------------------------------------------------------------
create or replace function public.owner_email()
returns text language sql stable security definer set search_path = public as $$
  select lower(value #>> '{}') from public.app_config where key = 'owner_email';
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_is_owner boolean := new.email_confirmed_at is not null
    and public.owner_email() is not null
    and lower(new.email) = public.owner_email();
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''),
          left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120))
  on conflict (id) do nothing;

  if v_is_owner then
    perform set_config('clippilot.owner_grant', 'on', true);
  end if;
  insert into public.user_roles (user_id, role)
  values (new.id, case when v_is_owner then 'OWNER'::public.app_role else 'USER'::public.app_role end)
  on conflict (user_id) do nothing;
  perform set_config('clippilot.owner_grant', '', true);

  insert into public.subscriptions (user_id, plan_id, status)
  values (new.id, 'free', 'active') on conflict (user_id) do nothing;
  insert into public.credit_balances (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

-- When the owner confirms their email, promote them. Only the address in
-- app_config.owner_email (written by the bootstrap script from OWNER_EMAIL)
-- is eligible, and only once the address is verified.
create or replace function public.handle_user_confirmed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null
     and public.owner_email() is not null and lower(new.email) = public.owner_email() then
    perform set_config('clippilot.owner_grant', 'on', true);
    update public.user_roles set role = 'OWNER' where user_id = new.id;
    perform set_config('clippilot.owner_grant', '', true);
    insert into public.admin_logs (actor_id, action, target_user_id, details)
    values (null, 'owner.promoted_on_confirm', new.id, '{}'::jsonb);
  end if;
  update public.profiles set email = coalesce(new.email, email) where id = new.id;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
create trigger on_auth_user_updated after update of email_confirmed_at, email on auth.users
  for each row execute function public.handle_user_confirmed();

-- Owner bootstrap: called by `npm run owner:init` with the service role.
-- Records OWNER_EMAIL, promotes that (verified) account and demotes any
-- other OWNER, so there is always at most one.
create or replace function public.bootstrap_owner(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_confirmed timestamptz;
begin
  if p_email is null or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid owner email';
  end if;
  insert into public.app_config (key, value) values ('owner_email', to_jsonb(lower(p_email)))
  on conflict (key) do update set value = excluded.value, updated_at = now();

  select id, email_confirmed_at into v_user, v_confirmed
  from auth.users where lower(email) = lower(p_email) limit 1;

  perform set_config('clippilot.owner_grant', 'on', true);
  update public.user_roles set role = 'USER'
   where role = 'OWNER' and (v_user is null or user_id <> v_user);
  if v_user is not null and v_confirmed is not null then
    insert into public.user_roles (user_id, role) values (v_user, 'OWNER')
    on conflict (user_id) do update set role = 'OWNER';
  end if;
  perform set_config('clippilot.owner_grant', '', true);

  insert into public.admin_logs (action, target_user_id, details)
  values ('owner.bootstrap', v_user, jsonb_build_object('email', lower(p_email),
          'promoted', v_user is not null and v_confirmed is not null));

  return jsonb_build_object(
    'owner_email', lower(p_email),
    'user_found', v_user is not null,
    'email_confirmed', v_confirmed is not null,
    'promoted', v_user is not null and v_confirmed is not null);
end $$;

-- ---------------------------------------------------------------------------
-- Entitlements & credits
-- ---------------------------------------------------------------------------

-- Rolls the monthly period forward when it has elapsed. Caller must hold a
-- lock on the balance row (or accept a benign race on reset).
create or replace function public.ensure_credit_period(p_user uuid)
returns public.credit_balances
language plpgsql security definer set search_path = public as $$
declare
  b public.credit_balances;
  s public.subscriptions;
begin
  insert into public.credit_balances (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into b from public.credit_balances where user_id = p_user for update;
  if now() >= b.period_end then
    select * into s from public.subscriptions where user_id = p_user;
    if s.current_period_end is not null and s.current_period_end > now()
       and s.current_period_start is not null and s.current_period_start <= now() then
      b.period_start := s.current_period_start;
      b.period_end := s.current_period_end;
    else
      b.period_start := b.period_end;
      while b.period_start + interval '1 month' <= now() loop
        b.period_start := b.period_start + interval '1 month';
      end loop;
      b.period_end := b.period_start + interval '1 month';
    end if;
    update public.credit_balances
       set period_start = b.period_start, period_end = b.period_end,
           minutes_used = 0, clips_used = 0, bonus_minutes = 0, bonus_clips = 0
     where user_id = p_user
     returning * into b;
    insert into public.credit_transactions (user_id, kind, note)
    values (p_user, 'period_reset', 'monthly reset');
  end if;
  return b;
end $$;

-- Single source of truth for what a user may do. Used by the web app
-- (server side) and by the workers.
create or replace function public.get_entitlements(p_user uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := coalesce(p_user, auth.uid());
  v_role public.app_role;
  v_plan public.plans;
  v_sub public.subscriptions;
  v_bal public.credit_balances;
  v_unlimited boolean;
  v_minutes_limit numeric;
  v_clips_limit integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  -- Regular users may only read their own entitlements.
  if auth.uid() is not null and v_user <> auth.uid() and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_role := public.role_of(v_user);
  v_unlimited := v_role = 'OWNER';
  select * into v_sub from public.subscriptions where user_id = v_user;
  if v_sub.plan_id is not null and v_sub.status in ('active', 'trialing', 'past_due') then
    select * into v_plan from public.plans where id = v_sub.plan_id;
  end if;
  if v_plan.id is null then
    select * into v_plan from public.plans where id = 'free';
  end if;
  v_bal := public.ensure_credit_period(v_user);
  v_minutes_limit := v_plan.monthly_minutes + v_bal.bonus_minutes;
  v_clips_limit := v_plan.monthly_clips + v_bal.bonus_clips;

  return jsonb_build_object(
    'user_id', v_user,
    'role', v_role,
    'unlimited', v_unlimited,
    'plan', jsonb_build_object('id', v_plan.id, 'name', v_plan.name),
    'subscription_status', coalesce(v_sub.status, 'active'),
    'cancel_at_period_end', coalesce(v_sub.cancel_at_period_end, false),
    'period_start', v_bal.period_start,
    'period_end', v_bal.period_end,
    'minutes_limit', case when v_unlimited then null else v_minutes_limit end,
    'minutes_used', v_bal.minutes_used,
    'minutes_remaining', case when v_unlimited then null else greatest(v_minutes_limit - v_bal.minutes_used, 0) end,
    'clips_limit', case when v_unlimited then null else v_clips_limit end,
    'clips_used', v_bal.clips_used,
    'clips_remaining', case when v_unlimited then null else greatest(v_clips_limit - v_bal.clips_used, 0) end,
    'max_resolution', case when v_unlimited then 1080 else v_plan.max_resolution end,
    'max_upload_mb', case when v_unlimited then 4096 else v_plan.max_upload_mb end,
    'max_video_minutes', case when v_unlimited then 240 else v_plan.max_video_minutes end,
    'watermark', case when v_unlimited then false else v_plan.watermark end,
    'priority', case when v_unlimited then 100 else v_plan.priority end,
    'features', case when v_unlimited then jsonb_build_object(
        'custom_subtitles', true, 'smart_crop', true, 'hook_detector', true,
        'virality_score', true, 'all_templates', true, 'priority_processing', true,
        'experimental', true)
      else v_plan.features || jsonb_build_object('experimental', false) end,
    'admin', v_role in ('OWNER', 'ADMIN')
  );
end $$;

-- Debits source minutes for a video. Idempotent per video. Raises
-- `insufficient_minutes` when the quota would be exceeded (except OWNER).
create or replace function public.consume_minutes(p_user uuid, p_minutes numeric, p_video uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b public.credit_balances;
  e jsonb;
  v_existing numeric;
begin
  if p_minutes is null or p_minutes <= 0 then
    raise exception 'invalid minutes';
  end if;
  b := public.ensure_credit_period(p_user); -- locks the row
  select minutes into v_existing from public.credit_transactions
   where user_id = p_user and kind = 'minutes_debit' and reference_type = 'video' and reference_id = p_video;
  if found then
    return jsonb_build_object('charged', v_existing, 'idempotent', true);
  end if;
  e := public.get_entitlements(p_user);
  if not (e ->> 'unlimited')::boolean and b.minutes_used + p_minutes > (e ->> 'minutes_limit')::numeric then
    raise exception 'insufficient_minutes' using errcode = 'P0001',
      detail = format('needed %s, remaining %s', p_minutes, e ->> 'minutes_remaining');
  end if;
  update public.credit_balances set minutes_used = minutes_used + p_minutes where user_id = p_user;
  insert into public.credit_transactions (user_id, kind, minutes, unlimited, reference_type, reference_id)
  values (p_user, 'minutes_debit', p_minutes, (e ->> 'unlimited')::boolean, 'video', p_video);
  insert into public.usage_logs (user_id, event, quantity, metadata)
  values (p_user, 'minutes.consumed', p_minutes, jsonb_build_object('video_id', p_video));
  return jsonb_build_object('charged', p_minutes, 'idempotent', false);
end $$;

-- Refunds the minutes debited for a video (e.g. processing failed for a
-- reason that is not the user's fault). Idempotent.
create or replace function public.refund_minutes(p_user uuid, p_video uuid, p_note text default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_amount numeric;
begin
  perform public.ensure_credit_period(p_user);
  select minutes into v_amount from public.credit_transactions
   where user_id = p_user and kind = 'minutes_debit' and reference_type = 'video' and reference_id = p_video;
  if not found then return 0; end if;
  if exists (select 1 from public.credit_transactions where user_id = p_user and kind = 'minutes_refund'
             and reference_type = 'video' and reference_id = p_video) then
    return 0;
  end if;
  update public.credit_balances set minutes_used = greatest(minutes_used - v_amount, 0) where user_id = p_user;
  insert into public.credit_transactions (user_id, kind, minutes, reference_type, reference_id, note)
  values (p_user, 'minutes_refund', v_amount, 'video', p_video, p_note);
  return v_amount;
end $$;

-- Debits one exportable clip. Idempotent per clip.
create or replace function public.consume_clip(p_user uuid, p_clip uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  b public.credit_balances;
  e jsonb;
begin
  b := public.ensure_credit_period(p_user);
  if exists (select 1 from public.credit_transactions where user_id = p_user and kind = 'clips_debit'
             and reference_type = 'clip' and reference_id = p_clip) then
    return true;
  end if;
  e := public.get_entitlements(p_user);
  if not (e ->> 'unlimited')::boolean and b.clips_used + 1 > (e ->> 'clips_limit')::integer then
    raise exception 'insufficient_clips' using errcode = 'P0001';
  end if;
  update public.credit_balances set clips_used = clips_used + 1 where user_id = p_user;
  insert into public.credit_transactions (user_id, kind, clips, unlimited, reference_type, reference_id)
  values (p_user, 'clips_debit', 1, (e ->> 'unlimited')::boolean, 'clip', p_clip);
  insert into public.usage_logs (user_id, event, quantity, metadata)
  values (p_user, 'clip.exported', 1, jsonb_build_object('clip_id', p_clip));
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Admin RPCs (callable by authenticated users; authorisation enforced here)
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_role(p_target uuid, p_role public.app_role)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_current public.app_role;
begin
  if not public.is_owner() then
    raise exception 'only the owner can manage roles' using errcode = '42501';
  end if;
  if p_role = 'OWNER' then
    raise exception 'OWNER cannot be granted through the API' using errcode = '42501';
  end if;
  if p_target = auth.uid() then
    raise exception 'you cannot change your own role' using errcode = '42501';
  end if;
  v_current := public.role_of(p_target);
  if v_current = 'OWNER' then
    raise exception 'the owner role cannot be changed' using errcode = '42501';
  end if;
  insert into public.user_roles (user_id, role, granted_by) values (p_target, p_role, auth.uid())
  on conflict (user_id) do update set role = excluded.role, granted_by = excluded.granted_by;
  insert into public.admin_logs (actor_id, action, target_user_id, details)
  values (auth.uid(), 'role.set', p_target, jsonb_build_object('from', v_current, 'to', p_role));
end $$;

create or replace function public.admin_grant_credits(
  p_target uuid, p_minutes integer, p_clips integer, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b public.credit_balances;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_target = auth.uid() and not public.is_owner() then
    raise exception 'admins cannot grant credits to themselves' using errcode = '42501';
  end if;
  if coalesce(p_minutes, 0) < 0 or coalesce(p_clips, 0) < 0
     or coalesce(p_minutes, 0) > 100000 or coalesce(p_clips, 0) > 10000
     or (coalesce(p_minutes, 0) = 0 and coalesce(p_clips, 0) = 0) then
    raise exception 'invalid amounts';
  end if;
  b := public.ensure_credit_period(p_target);
  update public.credit_balances
     set bonus_minutes = bonus_minutes + coalesce(p_minutes, 0),
         bonus_clips = bonus_clips + coalesce(p_clips, 0)
   where user_id = p_target returning * into b;
  insert into public.credit_transactions (user_id, kind, minutes, clips, note, created_by)
  values (p_target, 'admin_grant', coalesce(p_minutes, 0), coalesce(p_clips, 0), left(p_note, 500), auth.uid());
  insert into public.admin_logs (actor_id, action, target_user_id, details)
  values (auth.uid(), 'credits.grant', p_target,
          jsonb_build_object('minutes', p_minutes, 'clips', p_clips, 'note', left(p_note, 500)));
  return to_jsonb(b);
end $$;

create or replace function public.admin_set_plan(p_target uuid, p_plan text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_old text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.plans where id = p_plan) then
    raise exception 'unknown plan';
  end if;
  select plan_id into v_old from public.subscriptions where user_id = p_target;
  insert into public.subscriptions (user_id, plan_id, status) values (p_target, p_plan, 'active')
  on conflict (user_id) do update set plan_id = excluded.plan_id, status = 'active';
  insert into public.credit_transactions (user_id, kind, note, created_by)
  values (p_target, 'plan_change', format('%s -> %s (admin)', v_old, p_plan), auth.uid());
  insert into public.admin_logs (actor_id, action, target_user_id, details)
  values (auth.uid(), 'plan.set', p_target, jsonb_build_object('from', v_old, 'to', p_plan));
end $$;

create or replace function public.admin_stats()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'users_last_30d', (select count(*) from public.profiles where created_at > now() - interval '30 days'),
    'paying_subscribers', (select count(*) from public.subscriptions s join public.plans p on p.id = s.plan_id
                            where p.price_cents > 0 and s.status in ('active', 'trialing', 'past_due')
                              and s.stripe_subscription_id is not null),
    'videos_total', (select count(*) from public.videos),
    'videos_processed', (select count(*) from public.videos where status = 'ready'),
    'clips_total', (select count(*) from public.clips),
    'clips_ready', (select count(*) from public.clips where status = 'ready'),
    'minutes_processed', (select coalesce(sum(duration_seconds), 0) / 60 from public.videos where status = 'ready'),
    'storage_bytes_exports', (select coalesce(sum(size_bytes), 0) from public.exports),
    'storage_bytes_sources', (select coalesce(sum(size_bytes), 0) from public.videos where status <> 'expired'),
    'jobs_queued', (select count(*) from public.video_jobs where status = 'queued'),
    'jobs_running', (select count(*) from public.video_jobs where status = 'running'),
    'jobs_failed', (select count(*) from public.video_jobs where status = 'failed'),
    'jobs_failed_24h', (select count(*) from public.video_jobs where status = 'failed' and finished_at > now() - interval '1 day'),
    'compute_seconds_30d', (select coalesce(sum(extract(epoch from finished_at - started_at)), 0)
                             from public.video_jobs where finished_at > now() - interval '30 days' and started_at is not null),
    'revenue_cents_recorded', (select coalesce(sum((metadata ->> 'amount_paid')::bigint), 0)
                               from public.usage_logs where event = 'invoice.paid')
  );
end $$;

-- ---------------------------------------------------------------------------
-- Job queue (service role only)
-- ---------------------------------------------------------------------------
create or replace function public.claim_next_job(p_worker text, p_types public.job_type[] default null)
returns setof public.video_jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.video_jobs j
     set status = 'running', locked_by = p_worker, locked_at = now(), heartbeat_at = now(),
         started_at = coalesce(j.started_at, now()), attempts = j.attempts + 1, stage = 'starting'
   where j.id = (
     select q.id from public.video_jobs q
      where q.status = 'queued' and q.run_after <= now()
        and (p_types is null or q.type = any (p_types))
        -- fairness: at most one heavy job per user at a time
        and (q.type <> 'process_video' or q.user_id is null or not exists (
              select 1 from public.video_jobs r
               where r.user_id = q.user_id and r.status = 'running' and r.type = 'process_video'))
      order by q.priority desc, q.created_at
      for update skip locked
      limit 1)
  returning j.*;
end $$;

create or replace function public.job_heartbeat(p_job uuid, p_worker text, p_progress integer, p_stage text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.video_jobs
     set heartbeat_at = now(),
         progress = greatest(0, least(100, coalesce(p_progress, progress))),
         stage = coalesce(p_stage, stage)
   where id = p_job and locked_by = p_worker and status = 'running';
  return found;
end $$;

create or replace function public.complete_job(p_job uuid, p_worker text, p_result jsonb)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.video_jobs
     set status = 'succeeded', progress = 100, stage = 'done', finished_at = now(),
         result = coalesce(p_result, '{}'::jsonb), error = null, locked_by = null
   where id = p_job and locked_by = p_worker and status = 'running';
  return found;
end $$;

-- Retryable failures go back to the queue with exponential backoff.
create or replace function public.fail_job(p_job uuid, p_worker text, p_error text, p_retryable boolean)
returns public.job_status
language plpgsql security definer set search_path = public as $$
declare
  j public.video_jobs;
begin
  select * into j from public.video_jobs where id = p_job and locked_by = p_worker and status = 'running' for update;
  if not found then return null; end if;
  if p_retryable and j.attempts < j.max_attempts then
    update public.video_jobs
       set status = 'queued', locked_by = null, locked_at = null, stage = 'retry_scheduled',
           error = left(p_error, 2000),
           run_after = now() + make_interval(secs => 30 * power(2, j.attempts - 1))
     where id = p_job;
    return 'queued';
  end if;
  update public.video_jobs
     set status = 'failed', locked_by = null, finished_at = now(), stage = 'failed',
         error = left(p_error, 2000)
   where id = p_job;
  return 'failed';
end $$;

-- Jobs whose worker stopped heart-beating are put back in the queue (or
-- failed when out of attempts).
create or replace function public.requeue_stale_jobs(p_stale_seconds integer default 300)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  with stale as (
    select id, attempts, max_attempts from public.video_jobs
     where status = 'running' and heartbeat_at < now() - make_interval(secs => p_stale_seconds)
     for update skip locked)
  update public.video_jobs j
     set status = case when s.attempts < s.max_attempts then 'queued'::public.job_status else 'failed'::public.job_status end,
         finished_at = case when s.attempts < s.max_attempts then null else now() end,
         locked_by = null, locked_at = null,
         error = 'worker heartbeat lost', stage = 'stale'
    from stale s where j.id = s.id;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed window, service role only)
-- ---------------------------------------------------------------------------
create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.count + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning count into v_count;
  return v_count <= p_max;
end $$;

-- ---------------------------------------------------------------------------
-- EXECUTE privileges
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.role_of(uuid) to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.is_owner() to authenticated, service_role;
grant execute on function public.get_entitlements(uuid) to authenticated, service_role;
grant execute on function public.admin_set_role(uuid, public.app_role) to authenticated;
grant execute on function public.admin_grant_credits(uuid, integer, integer, text) to authenticated;
grant execute on function public.admin_set_plan(uuid, text) to authenticated;
grant execute on function public.admin_stats() to authenticated;

grant execute on function public.bootstrap_owner(text) to service_role;
grant execute on function public.ensure_credit_period(uuid) to service_role;
grant execute on function public.consume_minutes(uuid, numeric, uuid) to service_role;
grant execute on function public.refund_minutes(uuid, uuid, text) to service_role;
grant execute on function public.consume_clip(uuid, uuid) to service_role;
grant execute on function public.claim_next_job(text, public.job_type[]) to service_role;
grant execute on function public.job_heartbeat(uuid, text, integer, text) to service_role;
grant execute on function public.complete_job(uuid, text, jsonb) to service_role;
grant execute on function public.fail_job(uuid, text, text, boolean) to service_role;
grant execute on function public.requeue_stale_jobs(integer) to service_role;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
grant execute on function public.owner_email() to service_role;
