import type { Metadata } from "next";
import { FaqList } from "@/components/marketing/faq-list";

export const metadata: Metadata = { title: "FAQ" };

export default function FaqPage() {
  return (
    <div className="container max-w-3xl py-16 sm:py-24">
      <h1 className="mb-3 text-4xl font-semibold">Questions fréquentes</h1>
      <p className="mb-10 text-muted-foreground">Tout ce qu'il faut savoir pour bien démarrer avec ClipPilot.</p>
      <FaqList />
    </div>
  );
}
