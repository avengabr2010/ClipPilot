import type { AppRole } from "./entitlements";

/**
 * Role resolution. The database role is authoritative, but OWNER is only
 * honoured when the verified email also matches OWNER_EMAIL on the server.
 * If the env var changes or the row was tampered with, the account silently
 * falls back to USER (it never escalates).
 */
export function resolveEffectiveRole(input: {
  dbRole: AppRole | null | undefined;
  email: string | null | undefined;
  emailConfirmed: boolean;
  ownerEmail: string | null | undefined;
}): AppRole {
  const role = input.dbRole ?? "USER";
  if (role !== "OWNER") return role;
  const matches =
    !!input.ownerEmail && !!input.email && input.email.trim().toLowerCase() === input.ownerEmail.trim().toLowerCase();
  return matches && input.emailConfirmed ? "OWNER" : "USER";
}

export const isAdminRole = (r: AppRole) => r === "OWNER" || r === "ADMIN";

/** Which roles an actor may assign to a target. OWNER is never assignable. */
export function canAssignRole(actor: AppRole, targetCurrent: AppRole, next: AppRole, self: boolean): boolean {
  if (actor !== "OWNER") return false;
  if (self) return false;
  if (targetCurrent === "OWNER") return false;
  return next === "ADMIN" || next === "USER";
}
