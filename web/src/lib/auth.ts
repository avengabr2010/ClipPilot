import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import type { AppRole, Entitlements } from "@/lib/entitlements";
import { isAdminRole, resolveEffectiveRole } from "@/lib/permissions";

export interface SessionContext {
  user: User;
  role: AppRole;
  entitlements: Entitlements;
}

/**
 * Loads the authenticated user (verified with the Auth server via getUser,
 * never trusting the cookie payload alone), their effective role and
 * entitlements. Cached per request.
 */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: roleRow }, { data: ent, error }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
    supabase.rpc("get_entitlements", { p_user: user.id }),
  ]);
  if (error || !ent) throw new Error(`Could not load entitlements: ${error?.message ?? "empty"}`);

  const role = resolveEffectiveRole({
    dbRole: (roleRow?.role as AppRole) ?? "USER",
    email: user.email,
    emailConfirmed: Boolean(user.email_confirmed_at),
    ownerEmail: serverEnv().OWNER_EMAIL,
  });
  const entitlements = ent as Entitlements;
  // If the DB says OWNER but the server config does not confirm it, strip
  // the unlimited flag so that a tampered row can never grant free usage.
  if (entitlements.role === "OWNER" && role !== "OWNER") {
    entitlements.unlimited = false;
    entitlements.admin = false;
  }
  return { user, role, entitlements };
});

export async function requireSession(): Promise<SessionContext> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export async function requireAdmin(): Promise<SessionContext> {
  const s = await requireSession();
  if (!isAdminRole(s.role)) redirect("/dashboard");
  return s;
}
