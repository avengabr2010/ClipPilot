import { z } from "zod";
import { ApiError, assertUuid, json, parseBody, withAuth } from "@/lib/api";
import { getServerSupabase } from "@/lib/supabase/server";

/** Manually assigns a plan (comp accounts, support). Paid Stripe subscriptions should be changed in Stripe. */
export const POST = withAuth<{ id: string }>(
  async ({ req, params }) => {
    const id = assertUuid(params.id, "utilisateur");
    const { planId } = await parseBody(req, z.object({ planId: z.string().regex(/^[a-z0-9_-]{2,32}$/) }));
    const supabase = await getServerSupabase();
    const { error } = await supabase.rpc("admin_set_plan", { p_target: id, p_plan: planId });
    if (error) throw new ApiError(400, "plan_failed", error.message);
    return json({ planId });
  },
  { admin: true },
);
