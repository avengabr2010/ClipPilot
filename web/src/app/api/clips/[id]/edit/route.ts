import { z } from "zod";
import { ApiError, assertUuid, json, parseBody, withAuth } from "@/lib/api";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { hasFeature } from "@/lib/entitlements";
import { ASPECTS } from "@/lib/generation";
import { canUsePreset, getPreset, sanitizeStyle, type SubtitleStyle } from "@/lib/presets";

const wordSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string().max(64),
});

const editSchema = z.object({
  start: z.number().min(0),
  end: z.number().positive(),
  aspect: z.enum(ASPECTS),
  resolution: z.union([z.literal(720), z.literal(1080)]),
  template: z.string().min(1).max(32),
  subtitlesEnabled: z.boolean(),
  style: z.record(z.unknown()).optional(),
  words: z.array(wordSchema).max(4000).optional(),
  crop: z.object({ mode: z.enum(["auto", "manual", "center"]), x: z.number().min(0).max(1).optional(), zoom: z.number().min(1).max(2).optional() }),
});

const MIN_CLIP = 3;
const MAX_CLIP = 180;

/** Saves the editor state (validated + feature-gated server side). */
export const PUT = withAuth<{ id: string }>(async ({ req, session, params }) => {
  const id = assertUuid(params.id, "clip");
  const body = await parseBody(req, editSchema);
  const ent = session.entitlements;
  const admin = getAdminSupabase();
  const { data: clip } = await admin
    .from("clips")
    .select("id, video_id, videos(duration_seconds)")
    .eq("id", id)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!clip) throw new ApiError(404, "not_found", "Clip introuvable.");

  const videoDuration = Number((clip.videos as unknown as { duration_seconds: number } | null)?.duration_seconds ?? 0);
  const len = body.end - body.start;
  if (body.end > videoDuration + 0.05) throw new ApiError(400, "out_of_range", "La fin dépasse la durée de la vidéo.");
  if (len < MIN_CLIP || len > MAX_CLIP) throw new ApiError(400, "bad_length", `Un clip doit durer entre ${MIN_CLIP} et ${MAX_CLIP} secondes.`);
  if (body.resolution > ent.max_resolution) throw new ApiError(403, "resolution_locked", `Votre offre exporte en ${ent.max_resolution}p maximum.`);

  const preset = getPreset(body.template);
  if (!preset) throw new ApiError(400, "unknown_preset", "Modèle inconnu.");
  if (!canUsePreset(ent, preset)) throw new ApiError(403, "preset_locked", `Le modèle « ${preset.name} » n'est pas inclus dans votre offre.`);
  // Without the custom subtitles feature, only the preset as-is is allowed.
  const style: SubtitleStyle = hasFeature(ent, "custom_subtitles")
    ? sanitizeStyle(body.style as Partial<SubtitleStyle>, preset.style)
    : preset.style;
  if (body.crop.mode === "auto" && !hasFeature(ent, "smart_crop")) body.crop.mode = "center";

  const words = body.words
    ?.filter((w) => w.end > w.start && w.text.trim() !== "")
    .map((w) => ({ start: Math.round(w.start * 1000) / 1000, end: Math.round(w.end * 1000) / 1000, text: w.text.trim() }));

  const { error } = await admin.from("clip_edits").upsert({
    clip_id: id,
    user_id: session.user.id,
    start_seconds: body.start,
    end_seconds: body.end,
    aspect_ratio: body.aspect,
    resolution: body.resolution,
    template: preset.id,
    subtitle_style: style,
    subtitle_words: words ?? null,
    subtitles_enabled: body.subtitlesEnabled,
    crop: body.crop,
  });
  if (error) throw new ApiError(500, "db_error", "Enregistrement impossible.");
  return json({ saved: true, style });
});
