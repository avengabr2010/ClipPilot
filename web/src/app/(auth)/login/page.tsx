import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { Input, Label } from "@/components/ui/input";
import { signIn } from "../actions";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold">Bon retour 👋</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Connectez-vous pour retrouver vos clips.</p>
      {error === "link" && (
        <p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">Ce lien a expiré ou a déjà été utilisé.</p>
      )}
      <AuthForm action={signIn} submitLabel="Se connecter">
        <input type="hidden" name="next" value={next ?? "/dashboard"} />
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Mot de passe</Label>
            <Link href="/forgot-password" className="text-xs text-primary hover:underline">
              Mot de passe oublié ?
            </Link>
          </div>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
      </AuthForm>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Pas encore de compte ?{" "}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          Créer un compte
        </Link>
      </p>
    </>
  );
}
