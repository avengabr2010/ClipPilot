import "server-only";
import { getAdminSupabase } from "@/lib/supabase/admin";

export type FlagKey = "signups" | "uploads" | "billing" | "llm_analysis" | "speaker_tracking";

export async function getFlags(): Promise<Record<string, boolean>> {
  const { data } = await getAdminSupabase().from("feature_flags").select("key, enabled");
  return Object.fromEntries((data ?? []).map((f) => [f.key, f.enabled]));
}

export async function isFlagEnabled(key: FlagKey, fallback = true): Promise<boolean> {
  const flags = await getFlags();
  return flags[key] ?? fallback;
}
