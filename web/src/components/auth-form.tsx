"use client";
import { useActionState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AuthState } from "@/app/(auth)/actions";

/** Generic form wrapper bound to a server action with inline error/success messages. */
export function AuthForm({
  action,
  submitLabel,
  children,
}: {
  action: (state: AuthState, form: FormData) => Promise<AuthState>;
  submitLabel: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="space-y-4" noValidate>
      {children}
      {state?.error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> {state.error}
        </p>
      )}
      {state?.message && (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> {state.message}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
