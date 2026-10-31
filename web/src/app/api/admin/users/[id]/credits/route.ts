import { z } from "zod";
import { ApiError, assertUuid, json, parseBody, withAuth } from "@/lib/api";
import { getServerSupabase } from "@/lib/supabase/server";

export const POST = withAuth<{ id: string }>(
  async ({ req, params }) => {
    const id = assertUuid(params.id, "utilisateur");
    const body = await parseBody(
      req,
      z.object({
        minutes: z.number().int().min(0).max(100000),
        clips: z.number().int().min(0).max(10000),
        note: z.string().trim().min(3, "Indiquez un motif.").max(500),
      }),
    );
    const supabase = await getServerSupabase();
    const { data, error } = await supabase.rpc("admin_grant_credits", {
      p_target: id,
      p_minutes: body.minutes,
      p_clips: body.clips,
      p_note: body.note,
    });
    if (error) throw new ApiError(400, "grant_failed", error.message);
    return json(data);
  },
  { admin: true },
);
