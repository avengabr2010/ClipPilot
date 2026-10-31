import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { Input, Label } from "@/components/ui/input";
import { requestPasswordReset } from "../actions";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Mot de passe oublié</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Recevez un lien sécurisé pour choisir un nouveau mot de passe.</p>
      <AuthForm action={requestPasswordReset} submitLabel="Envoyer le lien">
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
      </AuthForm>
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="text-primary hover:underline">Retour à la connexion</Link>
      </p>
    </>
  );
}
