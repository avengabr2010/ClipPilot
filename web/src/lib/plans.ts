import "server-only";
import { createClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, publicEnv } from "@/lib/public-env";

export interface PublicPlan {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  monthly_minutes: number;
  monthly_clips: number;
  max_resolution: number;
  max_upload_mb: number;
  max_video_minutes: number;
  watermark: boolean;
  features: Record<string, boolean>;
  sort_order: number;
}

/** Defaults identical to the seed migration — used only if the database is unreachable. */
const FALLBACK: PublicPlan[] = [
  { id: "free", name: "Free", description: "Pour découvrir ClipPilot.", price_cents: 0, currency: "eur", monthly_minutes: 30, monthly_clips: 3, max_resolution: 720, max_upload_mb: 500, max_video_minutes: 30, watermark: true, sort_order: 0,
    features: { custom_subtitles: false, smart_crop: false, hook_detector: false, virality_score: false, all_templates: false, priority_processing: false } },
  { id: "starter", name: "Starter", description: "Pour publier chaque semaine.", price_cents: 599, currency: "eur", monthly_minutes: 180, monthly_clips: 30, max_resolution: 1080, max_upload_mb: 2048, max_video_minutes: 120, watermark: false, sort_order: 1,
    features: { custom_subtitles: true, smart_crop: true, hook_detector: false, virality_score: false, all_templates: false, priority_processing: false } },
  { id: "creator", name: "Creator", description: "Pour les créateurs réguliers.", price_cents: 1199, currency: "eur", monthly_minutes: 450, monthly_clips: 100, max_resolution: 1080, max_upload_mb: 4096, max_video_minutes: 180, watermark: false, sort_order: 2,
    features: { custom_subtitles: true, smart_crop: true, hook_detector: true, virality_score: true, all_templates: true, priority_processing: true } },
];

export async function getPublicPlans(): Promise<PublicPlan[]> {
  if (!isSupabaseConfigured) return FALLBACK;
  try {
    const sb = createClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, { auth: { persistSession: false } });
    const { data, error } = await sb
      .from("plans")
      .select("id, name, description, price_cents, currency, monthly_minutes, monthly_clips, max_resolution, max_upload_mb, max_video_minutes, watermark, features, sort_order")
      .eq("is_active", true)
      .order("sort_order");
    if (error || !data?.length) return FALLBACK;
    return data as PublicPlan[];
  } catch {
    return FALLBACK;
  }
}

export function planFeatureList(p: PublicPlan): { label: string; included: boolean }[] {
  const f = p.features;
  return [
    { label: `${p.monthly_minutes} minutes de vidéo source / mois`, included: true },
    { label: `${p.monthly_clips} clips exportables / mois`, included: true },
    { label: `Export jusqu'en ${p.max_resolution}p`, included: true },
    { label: p.watermark ? "Filigrane ClipPilot" : "Sans filigrane", included: !p.watermark },
    { label: f.custom_subtitles ? "Sous-titres personnalisables" : "Sous-titres classiques", included: true },
    { label: "Recadrage intelligent", included: !!f.smart_crop },
    { label: "Hook Detector", included: !!f.hook_detector },
    { label: "Virality Score", included: !!f.virality_score },
    { label: "Tous les modèles", included: !!f.all_templates },
    { label: "Traitement prioritaire", included: !!f.priority_processing },
  ];
}
