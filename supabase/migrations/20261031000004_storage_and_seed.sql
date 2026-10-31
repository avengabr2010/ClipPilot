-- ClipPilot — storage buckets, storage policies and seed data.

-- Private buckets. `sources` receives user uploads (direct, resumable TUS
-- upload from the browser); `exports` is written only by workers and read
-- through short-lived signed URLs generated server-side.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('sources', 'sources', false, 4294967296, array['video/mp4', 'video/quicktime', 'video/webm']),
  ('exports', 'exports', false, 1073741824, array['video/mp4', 'image/jpeg'])
on conflict (id) do nothing;

-- A user may upload ONLY to the exact path the server reserved for a video
-- they own and which is still in the `uploading` state. This blocks
-- arbitrary uploads, path traversal and overwrites of processed files.
create policy sources_insert_reserved on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sources'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.videos v
       where v.storage_path = name and v.user_id = auth.uid() and v.status = 'uploading'));

-- TUS resumable uploads need to read/update the in-progress object.
create policy sources_select_own on storage.objects for select to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text);
create policy sources_update_reserved on storage.objects for update to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.videos v
                 where v.storage_path = name and v.user_id = auth.uid() and v.status = 'uploading'));

-- ---------------------------------------------------------------------------
-- Seed: plans (editable later from /admin/plans)
-- ---------------------------------------------------------------------------
insert into public.plans (id, name, description, price_cents, currency, monthly_minutes, monthly_clips,
  max_resolution, max_upload_mb, max_video_minutes, watermark, priority, features, sort_order)
values
  ('free', 'Free', 'Pour découvrir ClipPilot.', 0, 'eur', 30, 3, 720, 500, 30, true, 0,
   '{"custom_subtitles": false, "smart_crop": false, "hook_detector": false, "virality_score": false, "all_templates": false, "priority_processing": false}', 0),
  ('starter', 'Starter', 'Pour publier chaque semaine.', 599, 'eur', 180, 30, 1080, 2048, 120, false, 10,
   '{"custom_subtitles": true, "smart_crop": true, "hook_detector": false, "virality_score": false, "all_templates": false, "priority_processing": false}', 1),
  ('creator', 'Creator', 'Pour les créateurs réguliers.', 1199, 'eur', 450, 100, 1080, 4096, 180, false, 50,
   '{"custom_subtitles": true, "smart_crop": true, "hook_detector": true, "virality_score": true, "all_templates": true, "priority_processing": true}', 2)
on conflict (id) do nothing;

insert into public.feature_flags (key, enabled, description, experimental) values
  ('signups', true, 'Autoriser les nouvelles inscriptions', false),
  ('uploads', true, 'Autoriser l''import de nouvelles vidéos', false),
  ('billing', false, 'Activer les abonnements payants (requiert Stripe configuré)', false),
  ('llm_analysis', true, 'Utiliser un LLM pour affiner titres et sélection (si une clé est configurée)', false),
  ('speaker_tracking', true, 'Suivi du locuteur actif lors du recadrage', true)
on conflict (key) do nothing;
