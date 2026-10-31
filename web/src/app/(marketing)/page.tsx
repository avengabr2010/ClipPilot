import Link from "next/link";
import { ArrowRight, Upload, Wand2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductDemo } from "@/components/marketing/product-demo";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { FaqList } from "@/components/marketing/faq-list";
import { getPublicPlans } from "@/lib/plans";
import { isBillingOpen } from "@/lib/billing-public";
import { FEATURES } from "@/lib/features";

export const revalidate = 300;

const STEPS = [
  { icon: Upload, title: "Importez", text: "Glissez votre vidéo (MP4, MOV, WEBM) ou choisissez-la dans votre galerie." },
  { icon: Wand2, title: "ClipPilot travaille", text: "Transcription, détection des meilleurs passages, recadrage et sous-titres." },
  { icon: Download, title: "Publiez", text: "Ajustez si besoin, téléchargez vos MP4 et publiez sur vos réseaux." },
];

export default async function HomePage() {
  const [plans, billingOpen] = await Promise.all([getPublicPlans(), isBillingOpen()]);
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="bg-grid absolute inset-0 -z-10" />
        <div className="glow-top absolute inset-0 -z-10" />
        <div className="container flex flex-col items-center pb-16 pt-14 text-center sm:pt-24">
          <Link
            href="/features"
            className="mb-6 inline-flex items-center gap-2 rounded-full border bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur hover:text-foreground"
          >
            <span className="rounded-full bg-primary/15 px-2 py-0.5 font-medium text-primary">Nouveau</span>
            Hook Detector et Virality Score
            <ArrowRight className="size-3" />
          </Link>
          <h1 className="max-w-4xl text-4xl font-semibold leading-[1.05] sm:text-6xl lg:text-7xl">
            Transformez vos longues vidéos en <span className="text-gradient">clips irrésistibles.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg">
            L'intelligence artificielle trouve vos meilleurs moments, crée vos clips et ajoute vos sous-titres. Vous n'avez plus qu'à
            publier.
          </p>
          <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Button asChild size="lg">
              <Link href="/signup">
                Commencer gratuitement <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#demo">Découvrir ClipPilot</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {plans.find((p) => p.price_cents === 0)?.monthly_minutes ?? 30} minutes offertes chaque mois · Sans carte bancaire
          </p>
          <div id="demo" className="mt-14 w-full scroll-mt-24">
            <ProductDemo />
          </div>
        </div>
      </section>

      <section className="container py-20">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-medium text-primary">Comment ça marche</p>
          <h2 className="mt-2 text-3xl font-semibold sm:text-4xl">De la vidéo brute aux clips prêts à publier</h2>
        </div>
        <ol className="mt-12 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-2xl border bg-card p-6 shadow-card">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <s.icon className="size-5" />
                </span>
                <span className="text-sm text-muted-foreground">Étape {i + 1}</span>
              </div>
              <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y bg-secondary/30 py-20">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-medium text-primary">Fonctionnalités</p>
            <h2 className="mt-2 text-3xl font-semibold sm:text-4xl">Tout ce qu'il faut, rien de superflu</h2>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.slice(0, 6).map((f) => (
              <div key={f.title} className="rounded-2xl border bg-card p-6">
                <f.icon className="size-5 text-primary" />
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Button asChild variant="outline">
              <Link href="/features">
                Toutes les fonctionnalités <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="container py-20" id="pricing">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <p className="text-sm font-medium text-primary">Tarifs</p>
          <h2 className="mt-2 text-3xl font-semibold sm:text-4xl">Simple et abordable</h2>
          <p className="mt-3 text-muted-foreground">Commencez gratuitement, passez à la vitesse supérieure quand vous êtes prêt.</p>
        </div>
        <PricingCards plans={plans} billingOpen={billingOpen} />
      </section>

      <section className="container max-w-3xl pb-20">
        <h2 className="mb-8 text-center text-3xl font-semibold">Questions fréquentes</h2>
        <FaqList limit={5} />
        <p className="mt-6 text-center text-sm">
          <Link href="/faq" className="text-primary hover:underline">
            Voir toutes les questions
          </Link>
        </p>
      </section>

      <section className="container pb-24">
        <div className="relative overflow-hidden rounded-3xl border bg-card px-6 py-14 text-center shadow-card">
          <div className="glow-top absolute inset-0" />
          <h2 className="relative text-3xl font-semibold sm:text-4xl">Votre prochaine vidéo mérite dix clips.</h2>
          <p className="relative mt-3 text-muted-foreground">Importez-la maintenant, ClipPilot s'occupe du reste.</p>
          <Button asChild size="lg" className="relative mt-8">
            <Link href="/signup">
              Créer mon compte gratuit <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
