import { z } from "zod";
import { ApiError, json, logAdmin, parseBody, withAuth } from "@/lib/api";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { stripeConfigured } from "@/lib/env";

export const PUT = withAuth<{ key: string }>(
  async ({ req, session, params }) => {
    const { enabled } = await parseBody(req, z.object({ enabled: z.boolean() }));
    if (params.key === "billing" && enabled && !stripeConfigured()) {
      throw new ApiError(400, "stripe_missing", "Configurez Stripe (clé secrète, secret webhook, prix) avant d'activer la facturation.");
    }
    const admin = getAdminSupabase();
    const { data, error } = await admin.from("feature_flags").update({ enabled }).eq("key", params.key).select("key").maybeSingle();
    if (error || !data) throw new ApiError(404, "not_found", "Fonctionnalité inconnue.");
    await logAdmin(session.user.id, "flag.set", null, { key: params.key, enabled });
    return json({ key: params.key, enabled });
  },
  { admin: true },
);
