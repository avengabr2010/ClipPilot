import { z } from "zod";
import { ApiError, assertUuid, json, parseBody, withAuth } from "@/lib/api";
import { getServerSupabase } from "@/lib/supabase/server";

/** Role change — enforced by the `admin_set_role` SQL function (OWNER only, never grants OWNER). */
export const POST = withAuth<{ id: string }>(
  async ({ req, params }) => {
    const id = assertUuid(params.id, "utilisateur");
    const { role } = await parseBody(req, z.object({ role: z.enum(["ADMIN", "USER"]) }));
    const supabase = await getServerSupabase();
    const { error } = await supabase.rpc("admin_set_role", { p_target: id, p_role: role });
    if (error) throw new ApiError(403, "forbidden", error.message);
    return json({ role });
  },
  { admin: true },
);
