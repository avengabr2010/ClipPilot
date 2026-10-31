import type { Metadata } from "next";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { FaqList } from "@/components/marketing/faq-list";
import { getPublicPlans } from "@/lib/plans";
import { isBillingOpen } from "@/lib/billing-public";

export const metadata: Metadata = { title: "Tarifs" };
export const revalidate = 300;

export default async function PricingPage() {
  const [plans, billingOpen] = await Promise.all([getPublicPlans(), isBillingOpen()]);
  return (
    <div className="container py-16 sm:py-24">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <h1 className="text-4xl font-semibold sm:text-5xl">Des tarifs clairs</h1>
        <p className="mt-4 text-muted-foreground">Payez pour ce que vous utilisez vraiment. Changez d'offre ou annulez à tout moment.</p>
        {!billingOpen && (
          <p className="mx-auto mt-4 max-w-md rounded-lg border bg-secondary/50 px-4 py-2 text-sm text-muted-foreground">
            Les offres payantes ouvriront prochainement. L'offre Free est disponible dès maintenant.
          </p>
        )}
      </div>
      <PricingCards plans={plans} billingOpen={billingOpen} />
      <p className="mt-6 text-center text-xs text-muted-foreground">Prix TTC. Minutes = durée des vidéos sources analysées.</p>
      <div className="mx-auto mt-20 max-w-3xl">
        <h2 className="mb-6 text-2xl font-semibold">Questions sur les offres</h2>
        <FaqList />
      </div>
    </div>
  );
}
