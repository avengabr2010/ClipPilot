import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { Input, Label } from "@/components/ui/input";
import { signUp } from "../actions";

export const metadata: Metadata = { title: "Inscription" };

export default function SignupPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Créez votre compte</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Gratuit, sans carte bancaire. Vos premiers clips en quelques minutes.</p>
      <AuthForm action={signUp} submitLabel="Créer mon compte">
        <div className="space-y-2">
          <Label htmlFor="fullName">Nom (facultatif)</Label>
          <Input id="fullName" name="fullName" autoComplete="name" maxLength={120} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Mot de passe</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
          <p className="text-xs text-muted-foreground">10 caractères minimum, avec au moins une lettre et un chiffre.</p>
        </div>
        <label className="flex items-start gap-2 text-sm text-muted-foreground">
          <input type="checkbox" name="terms" className="mt-1 size-4 accent-[hsl(var(--primary))]" required />
          <span>
            J'accepte les{" "}
            <Link href="/legal/terms" className="text-primary hover:underline" target="_blank">conditions d'utilisation</Link> et la{" "}
            <Link href="/legal/privacy" className="text-primary hover:underline" target="_blank">politique de confidentialité</Link>.
          </span>
        </label>
      </AuthForm>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Déjà inscrit ?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Se connecter
        </Link>
      </p>
    </>
  );
}
