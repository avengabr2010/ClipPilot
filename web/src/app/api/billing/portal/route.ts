import { ApiError, json, withAuth } from "@/lib/api";
import { getStripe } from "@/lib/stripe";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";

/** Stripe customer portal: change plan, cancel, renew, invoices, payment method. */
export const POST = withAuth(async ({ session }) => {
  const stripe = getStripe();
  if (!stripe) throw new ApiError(503, "billing_disabled", "La facturation n'est pas configurée.");
  const { data: sub } = await getAdminSupabase().from("subscriptions").select("stripe_customer_id").eq("user_id", session.user.id).single();
  if (!sub?.stripe_customer_id) throw new ApiError(404, "no_customer", "Aucun abonnement payant associé à ce compte.");
  const portal = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${serverEnv().NEXT_PUBLIC_SITE_URL}/billing`,
  });
  return json({ url: portal.url });
});
