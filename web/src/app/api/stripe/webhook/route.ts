import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { getStripe, syncSubscription } from "@/lib/stripe";
import { serverEnv } from "@/lib/env";
import { getAdminSupabase } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Stripe webhook — signature verified, idempotent per event id. */
export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: "billing not configured" }, { status: 503 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing signature" }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, serverEnv().STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const admin = getAdminSupabase();
  const { error: dupErr } = await admin.from("stripe_events").insert({ id: event.id, type: event.type });
  if (dupErr) {
    if (dupErr.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    return NextResponse.json({ error: "storage error" }, { status: 500 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.mode === "subscription" && s.subscription) {
          const sub = await stripe.subscriptions.retrieve(typeof s.subscription === "string" ? s.subscription : s.subscription.id);
          await syncSubscription(sub, s.client_reference_id);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      case "invoice.paid": {
        const inv = event.data.object as Stripe.Invoice;
        const customer = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
        const { data } = await admin.from("subscriptions").select("user_id").eq("stripe_customer_id", customer ?? "").maybeSingle();
        await admin.from("usage_logs").insert({
          user_id: data?.user_id ?? null,
          event: "invoice.paid",
          quantity: 1,
          metadata: { invoice_id: inv.id, amount_paid: inv.amount_paid, currency: inv.currency },
        });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    // Let Stripe retry: forget the event id so the retry is processed.
    await admin.from("stripe_events").delete().eq("id", event.id);
    console.error("[stripe] webhook handling failed", event.type, err);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
