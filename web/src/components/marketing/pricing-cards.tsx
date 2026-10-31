import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/format";
import { planFeatureList, type PublicPlan } from "@/lib/plans";
import { cn } from "@/lib/utils";

export function PricingCards({ plans, billingOpen }: { plans: PublicPlan[]; billingOpen: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {plans.map((p) => {
        const featured = p.id === "creator";
        return (
          <div
            key={p.id}
            className={cn(
              "relative flex flex-col rounded-2xl border bg-card p-6 shadow-card",
              featured && "border-primary/50 shadow-glow",
            )}
          >
            {featured && <Badge className="absolute -top-2.5 left-6">Le plus complet</Badge>}
            <h3 className="text-lg font-semibold">{p.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
            <div className="mt-5 flex items-baseline gap-1">
              <span className="font-display text-4xl font-semibold">{p.price_cents === 0 ? "0 €" : formatPrice(p.price_cents, p.currency)}</span>
              <span className="text-sm text-muted-foreground">/ mois</span>
            </div>
            <ul className="mt-6 flex-1 space-y-2.5 text-sm">
              {planFeatureList(p).map((f) => (
                <li key={f.label} className={cn("flex items-start gap-2", !f.included && "text-muted-foreground")}>
                  {f.included ? <Check className="mt-0.5 size-4 shrink-0 text-primary" /> : <Minus className="mt-0.5 size-4 shrink-0" />}
                  {f.label}
                </li>
              ))}
            </ul>
            <div className="mt-6">
              {p.price_cents === 0 ? (
                <Button asChild className="w-full" variant={featured ? "default" : "secondary"} size="lg">
                  <Link href="/signup">Commencer gratuitement</Link>
                </Button>
              ) : billingOpen ? (
                <Button asChild className="w-full" variant={featured ? "default" : "secondary"} size="lg">
                  <Link href={`/billing?upgrade=${p.id}`}>Choisir {p.name}</Link>
                </Button>
              ) : (
                <Button className="w-full" variant="secondary" size="lg" disabled>
                  Bientôt disponible
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
