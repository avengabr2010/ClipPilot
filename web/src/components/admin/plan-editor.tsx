"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api-client";

export interface AdminPlan {
  id: string; name: string; description: string; price_cents: number; monthly_minutes: number; monthly_clips: number;
  max_resolution: 720 | 1080; max_upload_mb: number; max_video_minutes: number; watermark: boolean; priority: number;
  is_active: boolean; stripe_price_id: string | null; features: Record<string, boolean>;
}

const FEATURES: [string, string][] = [
  ["custom_subtitles", "Sous-titres personnalisables"], ["smart_crop", "Recadrage intelligent"], ["hook_detector", "Hook Detector"],
  ["virality_score", "Virality Score"], ["all_templates", "Tous les modèles"], ["priority_processing", "Traitement prioritaire"],
];

export function PlanEditor({ plan }: { plan: AdminPlan }) {
  const router = useRouter();
  const [p, setP] = useState<AdminPlan>(plan);
  const [busy, setBusy] = useState(false);
  const num = (k: keyof AdminPlan) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: Math.max(0, Math.round(Number(e.target.value))) });
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center justify-between">{plan.name} <code className="text-xs text-muted-foreground">{plan.id}</code></CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1"><Label>Nom</Label><Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></div>
          <div className="col-span-2 space-y-1"><Label>Description</Label><Input value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} /></div>
          <div className="space-y-1"><Label>Prix (centimes/mois)</Label><Input type="number" value={p.price_cents} onChange={num("price_cents")} disabled={p.id === "free"} /></div>
          <div className="space-y-1"><Label>Priorité (0-99)</Label><Input type="number" value={p.priority} onChange={num("priority")} /></div>
          <div className="space-y-1"><Label>Minutes / mois</Label><Input type="number" value={p.monthly_minutes} onChange={num("monthly_minutes")} /></div>
          <div className="space-y-1"><Label>Clips / mois</Label><Input type="number" value={p.monthly_clips} onChange={num("monthly_clips")} /></div>
          <div className="space-y-1"><Label>Upload max (Mo)</Label><Input type="number" value={p.max_upload_mb} onChange={num("max_upload_mb")} /></div>
          <div className="space-y-1"><Label>Durée vidéo max (min)</Label><Input type="number" value={p.max_video_minutes} onChange={num("max_video_minutes")} /></div>
          <div className="space-y-1"><Label>Résolution max</Label>
            <NativeSelect value={p.max_resolution} onChange={(e) => setP({ ...p, max_resolution: Number(e.target.value) as 720 | 1080 })}><option value={720}>720p</option><option value={1080}>1080p</option></NativeSelect>
          </div>
          <div className="space-y-1"><Label>Stripe price ID</Label><Input value={p.stripe_price_id ?? ""} placeholder="price_…" onChange={(e) => setP({ ...p, stripe_price_id: e.target.value || null })} disabled={p.id === "free"} /></div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm">Filigrane <Switch checked={p.watermark} onCheckedChange={(v) => setP({ ...p, watermark: v })} /></label>
          <label className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm">Offre active <Switch checked={p.is_active} disabled={p.id === "free"} onCheckedChange={(v) => setP({ ...p, is_active: v })} /></label>
          {FEATURES.map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm">{label}
              <Switch checked={!!p.features[k]} onCheckedChange={(v) => setP({ ...p, features: { ...p.features, [k]: v } })} />
            </label>
          ))}
        </div>
        <Button loading={busy} onClick={async () => {
          setBusy(true);
          try {
            const features = Object.fromEntries(FEATURES.map(([k]) => [k, !!p.features[k]]));
            await apiFetch(`/api/admin/plans/${p.id}`, { method: "PUT", json: { ...p, id: undefined, features, stripe_price_id: p.stripe_price_id ?? "" } });
            toast.success(`Offre ${p.name} enregistrée`);
            router.refresh();
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}>Enregistrer</Button>
      </CardContent>
    </Card>
  );
}
