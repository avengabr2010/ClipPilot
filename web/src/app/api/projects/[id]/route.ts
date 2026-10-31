import { z } from "zod";
import { ApiError, assertUuid, json, parseBody, withAuth } from "@/lib/api";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { EXPORTS_BUCKET, SOURCES_BUCKET, removePrefix } from "@/lib/storage";

export const PATCH = withAuth<{ id: string }>(async ({ req, params }) => {
  const id = assertUuid(params.id, "projet");
  const { name } = await parseBody(req, z.object({ name: z.string().trim().min(1).max(120) }));
  // Runs as the user: RLS guarantees ownership.
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.from("projects").update({ name }).eq("id", id).select("id, name").maybeSingle();
  if (error || !data) throw new ApiError(404, "not_found", "Projet introuvable.");
  return json(data);
});

export const DELETE = withAuth<{ id: string }>(async ({ session, params }) => {
  const id = assertUuid(params.id, "projet");
  const admin = getAdminSupabase();
  const { data: project } = await admin.from("projects").select("id").eq("id", id).eq("user_id", session.user.id).maybeSingle();
  if (!project) throw new ApiError(404, "not_found", "Projet introuvable.");
  const [{ data: videos }, { data: clips }] = await Promise.all([
    admin.from("videos").select("id").eq("project_id", id),
    admin.from("clips").select("id").eq("project_id", id),
  ]);
  await admin.from("video_jobs").update({ status: "cancelled" }).in("video_id", (videos ?? []).map((v) => v.id)).in("status", ["queued", "running"]);
  for (const c of clips ?? []) await removePrefix(EXPORTS_BUCKET, `${session.user.id}/${c.id}`);
  for (const v of videos ?? []) await removePrefix(SOURCES_BUCKET, `${session.user.id}/${v.id}`);
  await admin.from("projects").delete().eq("id", id);
  return json({ deleted: true });
});
