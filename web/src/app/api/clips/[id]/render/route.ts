import { ApiError, assertUuid, json, rateLimit, withAuth } from "@/lib/api";
import { getAdminSupabase } from "@/lib/supabase/admin";

/** Queues a re-render of a clip with its saved edits. */
export const POST = withAuth<{ id: string }>(async ({ session, params }) => {
  const id = assertUuid(params.id, "clip");
  await rateLimit(`render:${session.user.id}`, 20, 600);
  const admin = getAdminSupabase();
  const { data: clip } = await admin
    .from("clips")
    .select("id, video_id, status, videos(status)")
    .eq("id", id)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!clip) throw new ApiError(404, "not_found", "Clip introuvable.");
  const vStatus = (clip.videos as unknown as { status: string } | null)?.status;
  if (vStatus === "expired") throw new ApiError(410, "source_expired", "La vidéo source a expiré : le clip ne peut plus être modifié.");

  // A clip that was never exported will consume one export credit.
  const { count: exported } = await admin.from("exports").select("id", { count: "exact", head: true }).eq("clip_id", id);
  if (!exported && !session.entitlements.unlimited && Number(session.entitlements.clips_remaining ?? 0) < 1) {
    throw new ApiError(402, "no_clips_left", "Vous n'avez plus de clips exportables ce mois-ci.");
  }
  const { count: pending } = await admin
    .from("video_jobs")
    .select("id", { count: "exact", head: true })
    .eq("clip_id", id)
    .in("status", ["queued", "running"]);
  if (pending) throw new ApiError(409, "already_rendering", "Un rendu est déjà en cours pour ce clip.");

  const { data: job, error } = await admin
    .from("video_jobs")
    .insert({ user_id: session.user.id, video_id: clip.video_id, clip_id: id, type: "render_clip", priority: session.entitlements.priority + 5 })
    .select("id")
    .single();
  if (error || !job) throw new ApiError(500, "db_error", "Impossible de lancer le rendu.");
  await admin.from("clips").update({ status: "rendering", error: null }).eq("id", id);
  return json({ jobId: job.id });
});
