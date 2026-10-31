import "server-only";
import { z } from "zod";

/**
 * Server-side environment. Secrets are read lazily and NEVER imported by
 * client components (the `server-only` import makes that a build error).
 */
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
  OWNER_EMAIL: z.string().email().optional(),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  STRIPE_PRICE_STARTER: z.string().startsWith("price_").optional(),
  STRIPE_PRICE_CREATOR: z.string().startsWith("price_").optional(),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
});

export type ServerEnv = z.infer<typeof schema>;
let cached: ServerEnv | null = null;

function clean(v: string | undefined) {
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(
    Object.fromEntries(Object.keys(schema.shape).map((k) => [k, clean(process.env[k])])),
  );
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid server environment: ${fields}. See .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

/** True when every value needed for paid plans is present. */
export function stripeConfigured(): boolean {
  const e = serverEnv();
  return Boolean(e.STRIPE_SECRET_KEY && e.STRIPE_WEBHOOK_SECRET && (e.STRIPE_PRICE_STARTER || e.STRIPE_PRICE_CREATOR));
}
