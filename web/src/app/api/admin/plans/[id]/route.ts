import { z } from "zod";
import { ApiError, json, logAdmin, parseBody, withAuth } from "@/lib/api";
import { getAdminSupabase } from "@/lib/supabase/admin";

const planSchema = z.object({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(200),
  price_cents: z.number().int().min(0).max(100000),
  monthly_minutes: z.number().int().min(0).max(100000),
  monthly_clips: z.number().int().min(0).max(10000),
  max_resolution: z.union([z.literal(720), z.literal(1080)]),
  max_upload_mb: z.number().int().min(10).max(10240),
  max_video_minutes: z.number().int().min(1).max(600),
  watermark: z.boolean(),
  priority: z.number().int().min(0).max(99),
  is_active: z.boolean(),
  stripe_price_id: z.string().trim().regex(/^price_[A-Za-z0-9]+$/).nullable().or(z.literal("").transform(() => null)),
  features: z.object({
    custom_subtitles: z.boolean(),
    smart_crop: z.boolean(),
    hook_detector: z.boolean(),
    virality_score: z.boolean(),
    all_templates: z.boolean(),
    priority_processing: z.boolean(),
  }),
});

export const PUT = withAuth<{ id: string }>(
  async ({ req, session, params }) => {
    if (!/^[a-z0-9_-]{2,32}$/.test(params.id)) throw new ApiError(400, "invalid_id", "Offre invalide.");
    const body = await parseBody(req, planSchema);
    if (params.id === "free" && body.price_cents !== 0) throw new ApiError(400, "free_price", "L'offre Free doit rester gratuite.");
    if (params.id === "free" && !body.is_active) throw new ApiError(400, "free_active", "L'offre Free ne peut pas être désactivée.");
    const admin = getAdminSupabase();
    const { data: before } = await admin.from("plans").select("*").eq("id", params.id).maybeSingle();
    if (!before) throw new ApiError(404, "not_found", "Offre introuvable.");
    const { error } = await admin.from("plans").update(body).eq("id", params.id);
    if (error) throw new ApiError(500, "db_error", "Mise à jour impossible.");
    await logAdmin(session.user.id, "plan.update", null, { plan: params.id, before, after: body });
    return json({ saved: true });
  },
  { admin: true },
);
