import { ApiError, assertUuid, json, rateLimit, withAuth } from "@/lib/api";
import { getAdminSupabase } from "@/lib/supabase/admin";

/** Re-queues a failed/cancelled job as a fresh job (quota is re-checked by the worker). */
export const POST = withAuth<{ id: string }>(async ({ session, params }) => {
  const id = assertUuid(params.id, "tâche");
  await rateLimit(`retry:${session.user.id}`, 10, 600);
  const admin = getAdminSupabase();
  const { data: job } = await admin
    .from("video_jobs")
    .select("id, status, type, video_id, clip_id, payload")
    .eq("id", id)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!job) throw new ApiError(404, "not_found", "Tâche introuvable.");
  if (!["failed", "cancelled"].includes(job.status)) throw new ApiError(409, "invalid_state", "Seules les tâches échouées peuvent être relancées.");
  if (job.video_id) {
    const { data: v } = await admin.from("videos").select("status").eq("id", job.video_id).single();
    if (v?.status === "expired") throw new ApiError(410, "expired", "La vidéo source a expiré, importez-la à nouveau.");
    if (job.type === "process_video") await admin.from("videos").update({ status: "uploaded", error: null }).eq("id", job.video_id);
  }
  const { data: created, error } = await admin
    .from("video_jobs")
    .insert({
      user_id: session.user.id,
      video_id: job.video_id,
      clip_id: job.clip_id,
      type: job.type,
      priority: session.entitlements.priority,
      payload: job.payload,
    })
    .select("id")
    .single();
  if (error || !created) throw new ApiError(500, "db_error", "Impossible de relancer la tâche.");
  return json({ jobId: created.id });
});
