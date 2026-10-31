import type { Metadata } from "next";
import { Check, Minus, Receipt, Sparkles } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/app/page-header";
import { CheckoutButton, CheckoutResultToast, PortalButton } from "@/components/app/billing-actions";
import { getPublicPlans, planFeatureList } from "@/lib/plans";
import { billingEnabled, getStripe } from "@/lib/stripe";
import { formatDate, formatMinutes, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Offre & crédits" };

const TX_LABELS: Record<string, string> = {
  minutes_debit: "Minutes consommées",
  minutes_refund: "Minutes recréditées",
  clips_debit: "Clip exporté",
  clips_refund: "Clip recrédité",
  admin_grant: "Crédits offerts",
  period_reset: "Nouvelle période",
  plan_change: "Changement d'offre",
};

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string; upgrade?: string }> }) {
  const { checkout, upgrade } = await searchParams;
  const { user, entitlements: e } = await requireSession();
  const sb = await getServerSupabase();
  const [plans, open, { data: sub }, { data: txs }] = await Promise.all([
    getPublicPlans(),
    billingEnabled(),
    sb.from("subscriptions").select("plan_id, status, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id").eq("user_id", user.id).maybeSingle(),
    sb.from("credit_transactions").select("id, kind, minutes, clips, note, created_at, unlimited").eq("user_id", user.id).order("created_at", { ascending: false }).limit(25),
  ]);

  let invoices: { id: string; number: string | null; amount: number; currency: string; status: string | null; created: number; url: string | null }[] = [];
  const stripe = getStripe();
  if (stripe && sub?.stripe_customer_id) {
    try {
      const list = await stripe.invoices.list({ customer: sub.stripe_customer_id, limit: 12 });
      invoices = list.data.map((i) => ({ id: i.id ?? "", number: i.number, amount: i.amount_paid, currency: i.currency, status: i.status, created: i.created, url: i.hosted_invoice_url ?? null }));
    } catch {
      invoices = [];
    }
  }

  const minutesPct = e.minutes_limit ? (Number(e.minutes_used) / e.minutes_limit) * 100 : 0;
  const clipsPct = e.clips_limit ? (e.clips_used / e.clips_limit) * 100 : 0;
  const paid = Boolean(sub?.stripe_subscription_id);

  return (
    <>
      <CheckoutResultToast result={checkout} />
      <PageHeader title="Offre & crédits" description="Votre abonnement, votre consommation et vos factures." actions={sub?.stripe_customer_id && stripe ? <PortalButton /> : undefined} />

      {e.unlimited ? (
        <Card className="mb-6 border-primary/40">
          <CardContent className="flex items-start gap-3 p-5">
            <Sparkles className="mt-0.5 size-5 text-primary" />
            <div>
              <p className="font-medium">Compte propriétaire — Premium intégral illimité</p>
              <p className="text-sm text-muted-foreground">
                Toutes les fonctionnalités, tous les modèles, 1080p sans filigrane, traitement prioritaire et fonctionnalités expérimentales, sans quota ni paiement.
                Les services externes (hébergement, API) restent facturés par leurs fournisseurs.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardDescription>Offre actuelle</CardDescription>
              <CardTitle className="flex items-center gap-2 text-2xl">
                {e.plan.name}
                {sub?.status && sub.status !== "active" && <Badge variant="warning">{sub.status}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {sub?.cancel_at_period_end && sub.current_period_end
                ? `Se termine le ${formatDate(sub.current_period_end)}, puis retour à l'offre Free.`
                : sub?.current_period_end
                  ? `Renouvellement le ${formatDate(sub.current_period_end)}.`
                  : `Quotas renouvelés le ${formatDate(e.period_end)}.`}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Minutes de vidéo</CardDescription>
              <CardTitle className="text-2xl">{formatMinutes(e.minutes_remaining)} <span className="text-sm font-normal text-muted-foreground">restantes</span></CardTitle>
            </CardHeader>
            <CardContent>
              <Progress value={minutesPct} label="Minutes utilisées" />
              <p className="mt-2 text-xs text-muted-foreground">{formatMinutes(Number(e.minutes_used))} utilisées sur {formatMinutes(e.minutes_limit)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Clips exportables</CardDescription>
              <CardTitle className="text-2xl">{e.clips_remaining} <span className="text-sm font-normal text-muted-foreground">restants</span></CardTitle>
            </CardHeader>
            <CardContent>
              <Progress value={clipsPct} label="Clips utilisés" />
              <p className="mt-2 text-xs text-muted-foreground">{e.clips_used} utilisés sur {e.clips_limit}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {!e.unlimited && (
        <section className="mb-8">
          <h2 className="mb-1 text-base font-semibold">Changer d'offre</h2>
          {!open && <p className="mb-3 text-sm text-muted-foreground">Les abonnements payants ne sont pas encore ouverts. Vous serez prévenu dès leur lancement.</p>}
          {open && paid && <p className="mb-3 text-sm text-muted-foreground">Pour changer d'offre ou annuler, utilisez « Gérer mon abonnement » : le prorata est calculé automatiquement.</p>}
          <div className="mt-3 grid gap-4 md:grid-cols-3">
            {plans.map((p) => {
              const current = p.id === e.plan.id;
              return (
                <Card key={p.id} className={cn(current && "border-primary/50")}>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">{p.name}{current && <Badge>Actuelle</Badge>}</CardTitle>
                    <CardDescription>{p.price_cents ? `${formatPrice(p.price_cents, p.currency)} / mois` : "Gratuit"}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-1.5 text-sm">
                      {planFeatureList(p).slice(0, 7).map((f) => (
                        <li key={f.label} className={cn("flex gap-2", !f.included && "text-muted-foreground")}>
                          {f.included ? <Check className="size-4 shrink-0 text-primary" /> : <Minus className="size-4 shrink-0" />} {f.label}
                        </li>
                      ))}
                    </ul>
                    {current ? (
                      <Button variant="secondary" className="w-full" disabled>Offre actuelle</Button>
                    ) : p.price_cents === 0 ? (
                      paid ? <PortalButton label="Revenir à Free" /> : null
                    ) : !open ? (
                      <Button className="w-full" variant="secondary" disabled>Bientôt disponible</Button>
                    ) : paid ? (
                      <PortalButton label={`Passer à ${p.name}`} />
                    ) : (
                      <CheckoutButton planId={p.id} label={`Choisir ${p.name}`} autoStart={upgrade === p.id} variant={p.id === "creator" ? "default" : "secondary"} />
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Historique de consommation</CardTitle></CardHeader>
          <CardContent>
            {txs?.length ? (
              <ul className="divide-y text-sm">
                {txs.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate">{TX_LABELS[t.kind] ?? t.kind}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(t.created_at, true)}{t.note ? ` · ${t.note}` : ""}</span>
                    </span>
                    <span className={cn("shrink-0 tabular-nums", t.kind.endsWith("debit") ? "text-muted-foreground" : "text-success")}>
                      {Number(t.minutes) ? `${t.kind.endsWith("debit") ? "−" : "+"}${formatMinutes(Number(t.minutes))}` : ""}
                      {t.clips ? ` ${t.kind.endsWith("debit") ? "−" : "+"}${t.clips} clip${t.clips > 1 ? "s" : ""}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Aucune consommation pour le moment.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Factures</CardTitle></CardHeader>
          <CardContent>
            {invoices.length ? (
              <ul className="divide-y text-sm">
                {invoices.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="flex items-center gap-2"><Receipt className="size-4 text-muted-foreground" /> {i.number ?? i.id} · {formatDate(new Date(i.created * 1000).toISOString())}</span>
                    <span className="flex items-center gap-3">
                      {formatPrice(i.amount, i.currency)}
                      {i.url && <a href={i.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">Voir</a>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Les factures apparaîtront ici après votre premier paiement.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
