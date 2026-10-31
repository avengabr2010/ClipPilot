import { ApiError, assertUuid, json, withAuth } from "@/lib/api";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { EXPORTS_BUCKET, SOURCES_BUCKET, signedUrl } from "@/lib/storage";

/** Signed URLs used by the editor: the source video (for live trimming) and the latest export. */
export const GET = withAuth<{ id: string }>(async ({ session, params }) => {
  const id = assertUuid(params.id, "clip");
  const admin = getAdminSupabase();
  const { data: clip } = await admin
    .from("clips")
    .select("id, videos(storage_path, status)")
    .eq("id", id)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!clip) throw new ApiError(404, "not_found", "Clip introuvable.");
  const video = clip.videos as unknown as { storage_path: string; status: string } | null;
  const { data: exp } = await admin
    .from("exports")
    .select("storage_path")
    .eq("clip_id", id)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const [sourceUrl, exportUrl] = await Promise.all([
    video && video.status !== "expired" ? signedUrl(SOURCES_BUCKET, video.storage_path) : null,
    exp ? signedUrl(EXPORTS_BUCKET, exp.storage_path) : null,
  ]);
  return json({ sourceUrl, exportUrl });
});
