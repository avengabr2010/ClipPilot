/**
 * Entitlements as returned by the `get_entitlements` SQL function — the
 * single source of truth for limits. These helpers are pure so they can be
 * used both on the server (enforcement) and the client (display only).
 */
export type AppRole = "OWNER" | "ADMIN" | "USER";

export type FeatureKey =
  | "custom_subtitles"
  | "smart_crop"
  | "hook_detector"
  | "virality_score"
  | "all_templates"
  | "priority_processing"
  | "experimental";

export interface Entitlements {
  user_id: string;
  role: AppRole;
  unlimited: boolean;
  admin: boolean;
  plan: { id: string; name: string };
  subscription_status: string;
  cancel_at_period_end: boolean;
  period_start: string;
  period_end: string;
  minutes_limit: number | null;
  minutes_used: number;
  minutes_remaining: number | null;
  clips_limit: number | null;
  clips_used: number;
  clips_remaining: number | null;
  max_resolution: 720 | 1080;
  max_upload_mb: number;
  max_video_minutes: number;
  watermark: boolean;
  priority: number;
  features: Partial<Record<FeatureKey, boolean>>;
}

export function hasFeature(e: Entitlements, f: FeatureKey): boolean {
  return e.unlimited || e.features[f] === true;
}

export function canProcessMinutes(e: Entitlements, minutes: number): { ok: true } | { ok: false; reason: string } {
  if (e.unlimited) return { ok: true };
  if (minutes > e.max_video_minutes) {
    return { ok: false, reason: `Votre offre accepte des vidéos de ${e.max_video_minutes} minutes maximum.` };
  }
  const remaining = Number(e.minutes_remaining ?? 0);
  if (minutes > remaining) {
    return {
      ok: false,
      reason: `Il vous reste ${Math.floor(remaining)} min ce mois-ci, cette vidéo en demande ${Math.ceil(minutes)}.`,
    };
  }
  return { ok: true };
}

/** Number of clips the user can still export (null = unlimited). */
export function clipsAvailable(e: Entitlements): number | null {
  return e.unlimited ? null : Math.max(0, Number(e.clips_remaining ?? 0));
}

export function clampClipCount(e: Entitlements, requested: number): number {
  const available = clipsAvailable(e);
  return available === null ? requested : Math.min(requested, available);
}
