import "server-only";
import Stripe from "stripe";
import { serverEnv, stripeConfigured } from "@/lib/env";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { isFlagEnabled } from "@/lib/flags";

let stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (!stripeConfigured()) return null;
  if (!stripe) stripe = new Stripe(serverEnv().STRIPE_SECRET_KEY!, { typescript: true, appInfo: { name: "ClipPilot" } });
  return stripe;
}

/** Paid plans are only purchasable when Stripe is configured AND the admin enabled billing. */
export async function billingEnabled(): Promise<boolean> {
  return stripeConfigured() && (await isFlagEnabled("billing", false));
}

/** Stripe price for a plan: admin-configured value first, then env fallback. */
export async function priceIdForPlan(planId: string): Promise<string | null> {
  const { data } = await getAdminSupabase().from("plans").select("stripe_price_id").eq("id", planId).maybeSingle();
  if (data?.stripe_price_id) return data.stripe_price_id;
  const env = serverEnv();
  if (planId === "starter") return env.STRIPE_PRICE_STARTER ?? null;
  if (planId === "creator") return env.STRIPE_PRICE_CREATOR ?? null;
  return null;
}

export async function planIdForPrice(priceId: string | null | undefined): Promise<string | null> {
  if (!priceId) return null;
  const { data } = await getAdminSupabase().from("plans").select("id").eq("stripe_price_id", priceId).maybeSingle();
  if (data?.id) return data.id;
  const env = serverEnv();
  if (priceId === env.STRIPE_PRICE_STARTER) return "starter";
  if (priceId === env.STRIPE_PRICE_CREATOR) return "creator";
  return null;
}

const STATUS_MAP: Record<string, string> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  canceled: "canceled",
  incomplete: "incomplete",
  incomplete_expired: "canceled",
  unpaid: "unpaid",
  paused: "past_due",
};

/** Mirrors a Stripe subscription into our `subscriptions` table. */
export async function syncSubscription(sub: Stripe.Subscription, userIdHint?: string | null) {
  const admin = getAdminSupabase();
  const item = sub.items.data[0];
  const planId = await planIdForPrice(item?.price?.id);
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  let userId = userIdHint ?? (sub.metadata?.user_id as string | undefined) ?? null;
  if (!userId) {
    const { data } = await admin.from("subscriptions").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
    userId = data?.user_id ?? null;
  }
  if (!userId) throw new Error(`No user for Stripe customer ${customerId}`);

  const ended = ["canceled", "incomplete_expired"].includes(sub.status);
  const toIso = (s?: number | null) => (s ? new Date(s * 1000).toISOString() : null);
  await admin
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        plan_id: ended || !planId ? "free" : planId,
        status: ended ? "active" : STATUS_MAP[sub.status] ?? "incomplete",
        stripe_customer_id: customerId,
        stripe_subscription_id: ended ? null : sub.id,
        current_period_start: ended ? null : toIso(item?.current_period_start),
        current_period_end: ended ? null : toIso(item?.current_period_end),
        cancel_at_period_end: ended ? false : sub.cancel_at_period_end,
      },
      { onConflict: "user_id" },
    );
  // The credit period follows the billing period automatically: when the
  // current credit period ends, ensure_credit_period() adopts the
  // subscription's current_period_start/end.
  return userId;
}
