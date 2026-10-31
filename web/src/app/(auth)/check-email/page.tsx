import type { Metadata } from "next";
import { MailCheck } from "lucide-react";
import { AuthForm } from "@/components/auth-form";
import { resendConfirmation } from "../actions";

export const metadata: Metadata = { title: "Vérifiez vos e-mails" };

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
        <MailCheck className="size-6" />
      </div>
      <h1 className="text-2xl font-semibold">Vérifiez votre boîte mail</h1>
      <p className="mb-6 mt-2 text-sm text-muted-foreground">
        Nous avons envoyé un lien de confirmation{email ? <> à <strong className="text-foreground">{email}</strong></> : null}. Cliquez dessus
        pour activer votre compte.
      </p>
      {email && (
        <AuthForm action={resendConfirmation} submitLabel="Renvoyer l'e-mail">
          <input type="hidden" name="email" value={email} />
        </AuthForm>
      )}
    </div>
  );
}
