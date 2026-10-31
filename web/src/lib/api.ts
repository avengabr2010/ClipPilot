import "server-only";
import { NextResponse } from "next/server";
import type { ZodSchema } from "zod";
import { getSession, type SessionContext } from "@/lib/auth";
import { isAdminRole } from "@/lib/permissions";
import { getAdminSupabase } from "@/lib/supabase/admin";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  console.error("[api] unexpected error", err);
  return NextResponse.json(
    { error: { code: "internal_error", message: "Une erreur inattendue est survenue. Réessayez dans un instant." } },
    { status: 500 },
  );
}

export async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Requête invalide.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, "validation_error", parsed.error.issues[0]?.message ?? "Données invalides.");
  }
  return parsed.data;
}

/** Rejects cross-site state-changing requests (defence in depth on top of SameSite cookies). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new ApiError(403, "bad_origin", "Origine non autorisée.");
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(403, "bad_origin", "Origine non autorisée.");
  }
}

/** Fixed-window rate limit backed by Postgres (works across serverless instances). */
export async function rateLimit(key: string, max: number, windowSeconds: number) {
  const { data, error } = await getAdminSupabase().rpc("rate_limit_hit", {
    p_key: key,
    p_window_seconds: windowSeconds,
    p_max: max,
  });
  if (error) {
    console.error("[rate-limit] failed", error.message);
    return; // fail open on infrastructure error, the action itself is still authorised
  }
  if (data === false) throw new ApiError(429, "rate_limited", "Trop de requêtes. Patientez quelques instants.");
}

type Handler<C> = (ctx: { req: Request; session: SessionContext; params: C }) => Promise<Response>;

/** Wraps an authenticated route handler with session, origin check and error handling. */
export function withAuth<C = Record<string, string>>(handler: Handler<C>, opts: { admin?: boolean } = {}) {
  return async (req: Request, routeCtx: { params: Promise<C> }) => {
    try {
      if (req.method !== "GET") assertSameOrigin(req);
      const session = await getSession();
      if (!session) throw new ApiError(401, "unauthenticated", "Connectez-vous pour continuer.");
      if (opts.admin && !isAdminRole(session.role)) throw new ApiError(403, "forbidden", "Accès réservé aux administrateurs.");
      const params = (routeCtx?.params ? await routeCtx.params : {}) as C;
      return await handler({ req, session, params });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function logAdmin(actorId: string, action: string, targetUserId: string | null, details: Record<string, unknown>) {
  await getAdminSupabase().from("admin_logs").insert({ actor_id: actorId, action, target_user_id: targetUserId, details });
}

export const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertUuid(v: string | undefined, what = "id"): string {
  if (!v || !uuidRe.test(v)) throw new ApiError(400, "invalid_id", `Identifiant ${what} invalide.`);
  return v;
}
