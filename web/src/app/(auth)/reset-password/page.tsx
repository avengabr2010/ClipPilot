import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { Input, Label } from "@/components/ui/input";
import { updatePassword } from "../actions";

export const metadata: Metadata = { title: "Nouveau mot de passe" };

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Nouveau mot de passe</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Choisissez un mot de passe que vous n'utilisez nulle part ailleurs.</p>
      <AuthForm action={updatePassword} submitLabel="Enregistrer">
        <div className="space-y-2">
          <Label htmlFor="password">Nouveau mot de passe</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirmation</Label>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </div>
      </AuthForm>
    </>
  );
}
