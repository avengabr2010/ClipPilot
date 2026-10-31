import "server-only";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";

export const SOURCES_BUCKET = "sources";
export const EXPORTS_BUCKET = "exports";

export async function signedUrl(bucket: string, path: string, downloadName?: string) {
  const { data, error } = await getAdminSupabase()
    .storage.from(bucket)
    .createSignedUrl(path, serverEnv().SIGNED_URL_TTL_SECONDS, downloadName ? { download: downloadName } : undefined);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function signedUrls(bucket: string, paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data } = await getAdminSupabase().storage.from(bucket).createSignedUrls(paths, serverEnv().SIGNED_URL_TTL_SECONDS);
  const out: Record<string, string> = {};
  for (const item of data ?? []) if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  return out;
}

/** Recursively removes everything under `prefix` in a bucket. */
export async function removePrefix(bucket: string, prefix: string) {
  const client = getAdminSupabase().storage.from(bucket);
  const { data } = await client.list(prefix, { limit: 1000 });
  if (!data || data.length === 0) return;
  const files: string[] = [];
  for (const entry of data) {
    const full = `${prefix}/${entry.name}`;
    if (entry.id === null) await removePrefix(bucket, full);
    else files.push(full);
  }
  if (files.length) await client.remove(files);
}
