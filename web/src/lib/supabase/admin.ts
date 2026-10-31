import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

let admin: SupabaseClient | null = null;

/**
 * Service-role client. BYPASSES RLS — only use after the caller's identity
 * and permissions were verified on the server. Never sent to the browser.
 */
export function getAdminSupabase(): SupabaseClient {
  if (!admin) {
    const env = serverEnv();
    admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}
