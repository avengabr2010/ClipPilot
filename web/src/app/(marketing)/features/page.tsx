import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FEATURES } from "@/lib/features";

export const metadata: Metadata = { title: "Fonctionnalités" };

const PIPELINE = [
  ["Transcription", "Whisper (open source) transcrit la parole avec un horodatage au mot près, en détectant la langue automatiquement."],
  ["Analyse", "Chaque passage candidat est évalué : accroche, émotion, anecdotes, explications, questions/réponses, autonomie."],
  ["Sélection", "Les meilleurs passages sont retenus en évitant chevauchements, répétitions et phrases coupées."],
  ["Montage", "FFmpeg découpe, recadre (suivi du visage), redimensionne et incruste les sous-titres."],
  ["Export", "Chaque MP4 est vérifié (durée, résolution, pistes) avant d'être marqué comme prêt."],
];

export default function FeaturesPage() {
  return (
    <div className="container py-16 sm:py-24">
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="text-4xl font-semibold sm:text-5xl">Un vrai moteur de clipping, pas un gadget</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          ClipPilot analyse réellement votre vidéo et produit de vrais fichiers MP4, prêts à publier.
        </p>
      </div>
      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-2xl border bg-card p-6 shadow-card">
            <f.icon className="size-5 text-primary" />
            <h2 className="mt-4 text-base font-semibold">{f.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
          </div>
        ))}
      </div>
      <section className="mx-auto mt-20 max-w-3xl">
        <h2 className="text-2xl font-semibold">Ce qui se passe après l'import</h2>
        <ol className="mt-6 space-y-3">
          {PIPELINE.map(([t, d], i) => (
            <li key={t} className="flex gap-4 rounded-xl border bg-card p-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">{i + 1}</span>
              <div>
                <h3 className="font-medium">{t}</h3>
                <p className="text-sm text-muted-foreground">{d}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-10 text-center">
          <Button asChild size="lg">
            <Link href="/signup">
              Essayer gratuitement <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
