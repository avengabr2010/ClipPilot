import { ApiError, assertUuid, json, withAuth } from "@/lib/api";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { SOURCES_BUCKET } from "@/lib/storage";

/**
 * Step 2 of an import: the browser reports the upload finished. We verify
 * the object really exists with the declared size, then enqueue the
 * processing job. The worker re-validates the file with ffprobe.
 */
export const POST = withAuth<{ id: string }>(async ({ session, params }) => {
  const id = assertUuid(params.id, "vidéo");
  const admin = getAdminSupabase();
  const { data: video } = await admin
    .from("videos")
    .select("id, user_id, storage_path, size_bytes, status")
    .eq("id", id)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!video) throw new ApiError(404, "not_found", "Vidéo introuvable.");
  if (video.status !== "uploading") throw new ApiError(409, "invalid_state", "Cette vidéo a déjà été envoyée.");

  const folder = video.storage_path.split("/").slice(0, -1).join("/");
  const file = video.storage_path.split("/").pop()!;
  const { data: objects } = await admin.storage.from(SOURCES_BUCKET).list(folder, { search: file });
  const obj = objects?.find((o) => o.name === file);
  if (!obj) throw new ApiError(409, "upload_missing", "Le fichier n'a pas été reçu. Relancez l'import.");
  const size = Number((obj.metadata as { size?: number } | null)?.size ?? 0);
  if (size && Math.abs(size - Number(video.size_bytes)) > 1024) {
    throw new ApiError(409, "size_mismatch", "Le fichier reçu est incomplet. Relancez l'import.");
  }

  const { error: upErr } = await admin.from("videos").update({ status: "uploaded" }).eq("id", id).eq("status", "uploading");
  if (upErr) throw new ApiError(500, "db_error", "Impossible de finaliser l'import.");

  const { data: job, error } = await admin
    .from("video_jobs")
    .insert({
      user_id: session.user.id,
      video_id: id,
      type: "process_video",
      priority: session.entitlements.priority,
      payload: {},
    })
    .select("id, status")
    .single();
  if (error || !job) throw new ApiError(500, "db_error", "Impossible de lancer le traitement.");
  await admin.from("usage_logs").insert({ user_id: session.user.id, event: "video.uploaded", quantity: size || video.size_bytes, metadata: { video_id: id } });
  return json({ jobId: job.id, status: job.status });
});
