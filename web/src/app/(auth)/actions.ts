"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { isFlagEnabled } from "@/lib/flags";

export type AuthState = { error?: string; message?: string } | undefined;

async function limit(action: string, max: number) {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  const { data } = await getAdminSupabase().rpc("rate_limit_hit", { p_key: `auth:${action}:${ip}`, p_window_seconds: 900, p_max: max });
  if (data === false) throw new Error("Trop de tentatives. Réessayez dans quelques minutes.");
}

const email = z.string().trim().toLowerCase().email("Adresse e-mail invalide.");
const password = z
  .string()
  .min(10, "10 caractères minimum.")
  .max(128)
  .regex(/[A-Za-z]/, "Ajoutez au moins une lettre.")
  .regex(/[0-9]/, "Ajoutez au moins un chiffre.");

function safeNext(next: FormDataEntryValue | null) {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard";
}

const AUTH_ERRORS: Record<string, string> = {
  "Invalid login credentials": "E-mail ou mot de passe incorrect.",
  "Email not confirmed": "Confirmez votre adresse e-mail avant de vous connecter (vérifiez vos spams).",
  "User already registered": "Un compte existe déjà avec cette adresse.",
};
const translate = (m: string) => AUTH_ERRORS[m] ?? "Une erreur est survenue. Réessayez.";

export async function signIn(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = z.object({ email, password: z.string().min(1, "Mot de passe requis.") }).safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await limit("login", 10);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const sb = await getServerSupabase();
  const { error } = await sb.auth.signInWithPassword(parsed.data);
  if (error) return { error: translate(error.message) };
  redirect(safeNext(form.get("next")));
}

export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = z
    .object({ email, password, fullName: z.string().trim().max(120).optional(), terms: z.literal("on", { message: "Acceptez les conditions d'utilisation." }) })
    .safeParse({ email: form.get("email"), password: form.get("password"), fullName: form.get("fullName") || undefined, terms: form.get("terms") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await limit("signup", 5);
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (!(await isFlagEnabled("signups"))) return { error: "Les inscriptions sont temporairement fermées." };
  const sb = await getServerSupabase();
  const { data, error } = await sb.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${serverEnv().NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/dashboard`,
      data: { full_name: parsed.data.fullName ?? "" },
    },
  });
  if (error) return { error: translate(error.message) };
  if (data.session) redirect("/dashboard"); // e-mail confirmation disabled in the project
  redirect(`/check-email?email=${encodeURIComponent(parsed.data.email)}`);
}

export async function requestPasswordReset(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = email.safeParse(form.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await limit("reset", 5);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const sb = await getServerSupabase();
  await sb.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${serverEnv().NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/reset-password`,
  });
  // Same answer whether the account exists or not (no user enumeration).
  return { message: "Si un compte existe pour cette adresse, un lien de réinitialisation vient d'être envoyé." };
}

export async function updatePassword(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = z
    .object({ password, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { message: "Les mots de passe ne correspondent pas." })
    .safeParse({ password: form.get("password"), confirm: form.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const sb = await getServerSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) return { error: "Lien expiré. Recommencez la procédure de réinitialisation." };
  const { error } = await sb.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "Impossible de mettre à jour le mot de passe (il doit être différent de l'ancien)." };
  redirect("/dashboard?password=updated");
}

export async function resendConfirmation(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = email.safeParse(form.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await limit("resend", 3);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const sb = await getServerSupabase();
  await sb.auth.resend({ type: "signup", email: parsed.data, options: { emailRedirectTo: `${serverEnv().NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/dashboard` } });
  return { message: "E-mail renvoyé. Pensez à vérifier vos spams." };
}
