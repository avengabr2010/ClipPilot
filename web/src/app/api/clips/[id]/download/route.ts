import { NextResponse } from "next/server";
import { ApiError, assertUuid, rateLimit, withAuth } from "@/lib/api";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { EXPORTS_BUCKET, signedUrl } from "@/lib/storage";
import { safeFilename } from "@/lib/upload";

/** Redirects to a short-lived signed URL of the clip's current MP4 export. */
export const GET = withAuth<{ id: string }>(async ({ session, params }) => {
  const id = assertUuid(params.id, "clip");
  await rateLimit(`download:${session.user.id}`, 120, 3600);
  const admin = getAdminSupabase();
  const { data: clip } = await admin.from("clips").select("id, title").eq("id", id).eq("user_id", session.user.id).maybeSingle();
  if (!clip) throw new ApiError(404, "not_found", "Clip introuvable.");
  const { data: exp } = await admin
    .from("exports")
    .select("storage_path")
    .eq("clip_id", id)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!exp) throw new ApiError(404, "no_export", "Ce clip n'a pas encore été exporté.");
  const url = await signedUrl(EXPORTS_BUCKET, exp.storage_path, `${safeFilename(clip.title)}.mp4`);
  if (!url) throw new ApiError(410, "file_missing", "Le fichier a expiré. Relancez l'export depuis l'éditeur.");
  await admin.from("usage_logs").insert({ user_id: session.user.id, event: "clip.downloaded", quantity: 1, metadata: { clip_id: id } });
  return NextResponse.redirect(url, 302);
});
