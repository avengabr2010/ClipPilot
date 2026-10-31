import { z } from "zod";
import { ApiError, json, parseBody, withAuth } from "@/lib/api";
import { getServerSupabase } from "@/lib/supabase/server";

export const PATCH = withAuth(async ({ req, session }) => {
  const body = await parseBody(
    req,
    z.object({ fullName: z.string().trim().max(120).optional(), onboardingCompleted: z.boolean().optional() }),
  );
  const patch: Record<string, unknown> = {};
  if (body.fullName !== undefined) patch.full_name = body.fullName;
  if (body.onboardingCompleted !== undefined) patch.onboarding_completed = body.onboardingCompleted;
  if (Object.keys(patch).length === 0) throw new ApiError(400, "empty", "Rien à mettre à jour.");
  const supabase = await getServerSupabase();
  const { error } = await supabase.from("profiles").update(patch).eq("id", session.user.id);
  if (error) throw new ApiError(500, "db_error", "Mise à jour impossible.");
  return json({ saved: true });
});
