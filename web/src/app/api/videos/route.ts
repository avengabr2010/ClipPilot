import { z } from "zod";
import { ApiError, json, parseBody, rateLimit, withAuth } from "@/lib/api";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { canProcessMinutes, clampClipCount, hasFeature } from "@/lib/entitlements";
import { generationSettingsSchema } from "@/lib/generation";
import { canUsePreset, getPreset } from "@/lib/presets";
import { extensionOf, safeFilename, validateUpload } from "@/lib/upload";
import { isFlagEnabled } from "@/lib/flags";
import { SOURCES_BUCKET } from "@/lib/storage";

const bodySchema = z.object({
  filename: z.string().min(1).max(255),
  size: z.number().int().positive(),
  type: z.string().max(100).optional(),
  durationSeconds: z.number().positive().max(24 * 3600),
  projectId: z.string().uuid().optional(),
  projectName: z.string().trim().min(1).max(120).optional(),
  settings: generationSettingsSchema,
});

/**
 * Step 1 of an import: validates the file metadata against the user's
 * entitlements, creates the project/video rows and reserves the storage
 * path. The browser then uploads directly to Supabase Storage (TUS) — the
 * storage policy only accepts that exact path while the video is `uploading`.
 */
export const POST = withAuth(async ({ req, session }) => {
  const { user, entitlements: ent } = session;
  await rateLimit(`upload:${user.id}`, 30, 3600);
  if (!(await isFlagEnabled("uploads")) && !ent.unlimited) {
    throw new ApiError(503, "uploads_disabled", "Les imports sont temporairement suspendus.");
  }
  const body = await parseBody(req, bodySchema);

  const check = validateUpload({
    filename: body.filename,
    size: body.size,
    type: body.type,
    durationSeconds: body.durationSeconds,
    maxUploadMb: ent.max_upload_mb,
    maxVideoMinutes: ent.max_video_minutes,
  });
  if (!check.ok) throw new ApiError(400, "invalid_file", check.error);

  const quota = canProcessMinutes(ent, body.durationSeconds / 60);
  if (!quota.ok) throw new ApiError(402, "quota_exceeded", quota.reason);

  const clipCount = clampClipCount(ent, body.settings.clipCount);
  if (clipCount < 1) {
    throw new ApiError(402, "no_clips_left", "Vous avez utilisé tous vos clips exportables ce mois-ci.");
  }
  if (body.settings.resolution > ent.max_resolution) {
    throw new ApiError(403, "resolution_locked", `Votre offre exporte en ${ent.max_resolution}p maximum.`);
  }
  const preset = getPreset(body.settings.subtitlePreset);
  if (!preset) throw new ApiError(400, "unknown_preset", "Modèle de sous-titres inconnu.");
  if (!canUsePreset(ent, preset)) {
    throw new ApiError(403, "preset_locked", `Le modèle « ${preset.name} » n'est pas inclus dans votre offre.`);
  }
  const settings = {
    ...body.settings,
    clipCount,
    smartCrop: body.settings.smartCrop && hasFeature(ent, "smart_crop"),
    hookDetector: hasFeature(ent, "hook_detector"),
    viralityScore: hasFeature(ent, "virality_score"),
    watermark: ent.watermark,
  };

  const admin = getAdminSupabase();
  let projectId = body.projectId;
  if (projectId) {
    const { data: p } = await admin.from("projects").select("id").eq("id", projectId).eq("user_id", user.id).maybeSingle();
    if (!p) throw new ApiError(404, "project_not_found", "Projet introuvable.");
  } else {
    const name = body.projectName ?? safeFilename(body.filename).replace(/\.[a-z0-9]+$/i, "");
    const { data: p, error } = await admin.from("projects").insert({ user_id: user.id, name }).select("id").single();
    if (error || !p) throw new ApiError(500, "db_error", "Impossible de créer le projet.");
    projectId = p.id;
  }

  const videoId = crypto.randomUUID();
  const ext = extensionOf(body.filename) === "m4v" ? "mp4" : extensionOf(body.filename);
  const storagePath = `${user.id}/${videoId}/source.${ext}`;
  const { error } = await admin.from("videos").insert({
    id: videoId,
    user_id: user.id,
    project_id: projectId,
    original_filename: safeFilename(body.filename),
    storage_path: storagePath,
    mime_type: check.mime,
    size_bytes: body.size,
    declared_duration_seconds: body.durationSeconds,
    status: "uploading",
    settings,
  });
  if (error) throw new ApiError(500, "db_error", "Impossible de préparer l'import.");

  return json({ videoId, projectId, bucket: SOURCES_BUCKET, path: storagePath, mime: check.mime, settings }, { status: 201 });
});
