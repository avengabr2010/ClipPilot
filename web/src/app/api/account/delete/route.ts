import { z } from "zod";
import { ApiError, json, parseBody, rateLimit, withAuth } from "@/lib/api";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { EXPORTS_BUCKET, SOURCES_BUCKET, removePrefix } from "@/lib/storage";

/** Permanently deletes the account, all files and cancels any paid subscription. */
export const POST = withAuth(async ({ req, session }) => {
  await rateLimit(`delete-account:${session.user.id}`, 3, 3600);
  const { confirm } = await parseBody(req, z.object({ confirm: z.string() }));
  if (confirm.trim().toUpperCase() !== "SUPPRIMER") throw new ApiError(400, "confirm", "Tapez SUPPRIMER pour confirmer.");
  if (session.role === "OWNER") {
    throw new ApiError(403, "owner", "Le compte propriétaire ne peut pas être supprimé depuis l'application.");
  }
  const admin = getAdminSupabase();
  const { data: sub } = await admin.from("subscriptions").select("stripe_subscription_id").eq("user_id", session.user.id).maybeSingle();
  const stripe = getStripe();
  if (sub?.stripe_subscription_id && stripe) await stripe.subscriptions.cancel(sub.stripe_subscription_id);

  await admin.from("video_jobs").update({ status: "cancelled" }).eq("user_id", session.user.id).in("status", ["queued", "running"]);
  await removePrefix(SOURCES_BUCKET, session.user.id);
  await removePrefix(EXPORTS_BUCKET, session.user.id);
  const { error } = await admin.auth.admin.deleteUser(session.user.id);
  if (error) throw new ApiError(500, "delete_failed", "La suppression a échoué. Contactez le support.");
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  return json({ deleted: true });
});
