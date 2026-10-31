import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/logo";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <LogoMark className="size-10" />
      <h1 className="text-3xl font-semibold">Page introuvable</h1>
      <p className="max-w-sm text-muted-foreground">Cette page n'existe pas ou vous n'y avez pas accès.</p>
      <Button asChild><Link href="/">Retour à l'accueil</Link></Button>
    </div>
  );
}
