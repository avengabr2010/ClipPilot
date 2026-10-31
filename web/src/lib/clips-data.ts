import "server-only";
import type { ClipCardData } from "@/components/app/clip-card";
import { EXPORTS_BUCKET, signedUrls } from "@/lib/storage";

export interface ClipRow {
  id: string;
  user_id: string;
  title: string;
  duration_seconds: number;
  virality_score: number | null;
  hook_type: string | null;
  status: string;
  created_at: string;
  project_id: string;
  projects?: { name: string } | null;
  clip_edits?: { aspect_ratio: string } | null;
  exports?: { id: string }[];
}

export const CLIP_SELECT =
  "id, user_id, title, duration_seconds, virality_score, hook_type, status, created_at, project_id, projects(name), clip_edits(aspect_ratio), exports(id)";

/** Adds signed thumbnail URLs (one batch request) to clip rows. */
export async function toClipCards(rows: ClipRow[], withProject = false): Promise<ClipCardData[]> {
  const paths = rows.filter((r) => r.exports?.length).map((r) => `${r.user_id}/${r.id}/thumb.jpg`);
  const urls = await signedUrls(EXPORTS_BUCKET, paths);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    duration_seconds: Number(r.duration_seconds),
    virality_score: r.virality_score,
    hook_type: r.hook_type,
    status: r.status,
    aspect: r.clip_edits?.aspect_ratio ?? "9:16",
    thumbUrl: urls[`${r.user_id}/${r.id}/thumb.jpg`] ?? null,
    projectName: withProject ? r.projects?.name : undefined,
    hasExport: Boolean(r.exports?.length),
  }));
}

