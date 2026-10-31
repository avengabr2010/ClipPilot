"use client";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <AlertTriangle className="size-8 text-warning" />
      <h1 className="mt-4 text-xl font-semibold">Quelque chose s'est mal passé</h1>
      <p className="mt-2 text-sm text-muted-foreground">Le chargement de cette page a échoué. Réessayez ; si le problème persiste, contactez le support{error.digest ? ` (réf. ${error.digest})` : ""}.</p>
      <Button className="mt-6" onClick={reset}>Réessayer</Button>
    </div>
  );
}
