import { z } from "zod";
import { ApiError, assertUuid, json, parseBody, withAuth } from "@/lib/api";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { EXPORTS_BUCKET, removePrefix } from "@/lib/storage";

/** Rename a clip (RLS restricts the update to the `title` column of own clips). */
export const PATCH = withAuth<{ id: string }>(async ({ req, params }) => {
  const id = assertUuid(params.id, "clip");
  const { title } = await parseBody(req, z.object({ title: z.string().trim().min(1, "Le titre est vide.").max(160) }));
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.from("clips").update({ title }).eq("id", id).select("id, title").maybeSingle();
  if (error || !data) throw new ApiError(404, "not_found", "Clip introuvable.");
  return json(data);
});

export const DELETE = withAuth<{ id: string }>(async ({ session, params }) => {
  const id = assertUuid(params.id, "clip");
  const admin = getAdminSupabase();
  const { data: clip } = await admin.from("clips").select("id").eq("id", id).eq("user_id", session.user.id).maybeSingle();
  if (!clip) throw new ApiError(404, "not_found", "Clip introuvable.");
  await admin.from("video_jobs").update({ status: "cancelled" }).eq("clip_id", id).in("status", ["queued", "running"]);
  await removePrefix(EXPORTS_BUCKET, `${session.user.id}/${id}`);
  await admin.from("clips").delete().eq("id", id);
  return json({ deleted: true });
});
