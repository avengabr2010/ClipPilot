import { ApiError, assertUuid, json, withAuth } from "@/lib/api";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { EXPORTS_BUCKET, SOURCES_BUCKET, removePrefix } from "@/lib/storage";

/** Deletes a video, its clips, exports and every stored file. */
export const DELETE = withAuth<{ id: string }>(async ({ session, params }) => {
  const id = assertUuid(params.id, "vidéo");
  const admin = getAdminSupabase();
  const { data: video } = await admin.from("videos").select("id").eq("id", id).eq("user_id", session.user.id).maybeSingle();
  if (!video) throw new ApiError(404, "not_found", "Vidéo introuvable.");

  await admin.from("video_jobs").update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("video_id", id).in("status", ["queued", "running"]);
  const { data: clips } = await admin.from("clips").select("id").eq("video_id", id);
  for (const c of clips ?? []) await removePrefix(EXPORTS_BUCKET, `${session.user.id}/${c.id}`);
  await removePrefix(SOURCES_BUCKET, `${session.user.id}/${id}`);
  const { error } = await admin.from("videos").delete().eq("id", id);
  if (error) throw new ApiError(500, "db_error", "Suppression impossible.");
  return json({ deleted: true });
});
