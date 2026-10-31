"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/public-env";

let client: SupabaseClient | null = null;

/** Browser client — uses the anon key and the user's session (RLS applies). */
export function getBrowserSupabase(): SupabaseClient {
  if (!client) client = createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
  return client;
}
