import { ApiError, assertUuid, json, logAdmin, withAuth } from "@/lib/api";
import { getAdminSupabase } from "@/lib/supabase/admin";

/** Admin re-queue of a failed job (any user). */
export const POST = withAuth<{ id: string }>(
  async ({ session, params }) => {
    const id = assertUuid(params.id, "tâche");
    const admin = getAdminSupabase();
    const { data: job } = await admin.from("video_jobs").select("*").eq("id", id).maybeSingle();
    if (!job) throw new ApiError(404, "not_found", "Tâche introuvable.");
    if (!["failed", "cancelled"].includes(job.status)) throw new ApiError(409, "invalid_state", "Tâche non échouée.");
    if (job.type === "process_video" && job.video_id) {
      await admin.from("videos").update({ status: "uploaded", error: null }).eq("id", job.video_id).neq("status", "expired");
    }
    const { data: created, error } = await admin
      .from("video_jobs")
      .insert({ user_id: job.user_id, video_id: job.video_id, clip_id: job.clip_id, type: job.type, priority: job.priority, payload: job.payload })
      .select("id")
      .single();
    if (error || !created) throw new ApiError(500, "db_error", "Relance impossible.");
    await logAdmin(session.user.id, "job.retry", job.user_id, { job_id: id, new_job_id: created.id });
    return json({ jobId: created.id });
  },
  { admin: true },
);
