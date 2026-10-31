import { ApiError, assertUuid, json, withAuth } from "@/lib/api";
import { getAdminSupabase } from "@/lib/supabase/admin";

/**
 * Cancels a queued or running job. A running worker notices on its next
 * heartbeat (which then returns false) and aborts; minutes already debited
 * for an unfinished analysis are refunded.
 */
export const POST = withAuth<{ id: string }>(async ({ session, params }) => {
  const id = assertUuid(params.id, "tâche");
  const admin = getAdminSupabase();
  const { data: job } = await admin
    .from("video_jobs")
    .select("id, status, type, video_id")
    .eq("id", id)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!job) throw new ApiError(404, "not_found", "Tâche introuvable.");
  if (!["queued", "running"].includes(job.status)) throw new ApiError(409, "invalid_state", "Cette tâche est déjà terminée.");

  await admin
    .from("video_jobs")
    .update({ status: "cancelled", stage: "cancelled", finished_at: new Date().toISOString(), locked_by: null })
    .eq("id", id)
    .in("status", ["queued", "running"]);
  if (job.type === "process_video" && job.video_id) {
    await admin.rpc("refund_minutes", { p_user: session.user.id, p_video: job.video_id, p_note: "cancelled by user" });
    await admin.from("videos").update({ status: "failed", error: "Traitement annulé." }).eq("id", job.video_id);
  }
  return json({ cancelled: true });
});
