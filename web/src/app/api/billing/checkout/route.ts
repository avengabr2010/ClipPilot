import { z } from "zod";
import { ApiError, json, parseBody, rateLimit, withAuth } from "@/lib/api";
import { billingEnabled, getStripe, priceIdForPlan } from "@/lib/stripe";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";

export const POST = withAuth(async ({ req, session }) => {
  if (session.entitlements.unlimited) throw new ApiError(400, "owner", "Le compte propriétaire dispose déjà de toutes les fonctionnalités.");
  if (!(await billingEnabled())) throw new ApiError(503, "billing_disabled", "Les abonnements payants ne sont pas encore ouverts.");
  await rateLimit(`checkout:${session.user.id}`, 10, 3600);
  const { planId } = await parseBody(req, z.object({ planId: z.enum(["starter", "creator"]) }));
  const stripe = getStripe()!;
  const price = await priceIdForPlan(planId);
  if (!price) throw new ApiError(503, "price_missing", "Cette offre n'est pas encore disponible à l'achat.");

  const admin = getAdminSupabase();
  const { data: sub } = await admin.from("subscriptions").select("stripe_customer_id, stripe_subscription_id").eq("user_id", session.user.id).single();
  if (sub?.stripe_subscription_id) {
    throw new ApiError(409, "already_subscribed", "Vous avez déjà un abonnement : changez d'offre depuis le portail de facturation.");
  }
  let customer = sub?.stripe_customer_id ?? null;
  if (!customer) {
    const c = await stripe.customers.create({ email: session.user.email, metadata: { user_id: session.user.id } });
    customer = c.id;
    await admin.from("subscriptions").update({ stripe_customer_id: customer }).eq("user_id", session.user.id);
  }
  const site = serverEnv().NEXT_PUBLIC_SITE_URL;
  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: session.user.id,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { user_id: session.user.id, plan_id: planId } },
    allow_promotion_codes: true,
    success_url: `${site}/billing?checkout=success`,
    cancel_url: `${site}/billing?checkout=cancelled`,
  });
  return json({ url: checkout.url });
});
