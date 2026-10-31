import { Badge } from "@/components/ui/badge";

const MAP: Record<string, { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" | "outline" }> = {
  uploading: { label: "Import en cours", variant: "secondary" },
  uploaded: { label: "En file d'attente", variant: "secondary" },
  processing: { label: "Traitement", variant: "default" },
  ready: { label: "Prêt", variant: "success" },
  failed: { label: "Échec", variant: "destructive" },
  expired: { label: "Source expirée", variant: "outline" },
  pending: { label: "En attente", variant: "secondary" },
  rendering: { label: "Rendu…", variant: "default" },
  queued: { label: "En file d'attente", variant: "secondary" },
  running: { label: "En cours", variant: "default" },
  succeeded: { label: "Terminé", variant: "success" },
  cancelled: { label: "Annulé", variant: "outline" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = MAP[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export const STAGE_LABELS: Record<string, string> = {
  queued: "En file d'attente",
  starting: "Démarrage",
  downloading: "Récupération de la vidéo",
  probing: "Vérification du fichier",
  extracting_audio: "Extraction de l'audio",
  transcribing: "Transcription de la parole",
  analyzing: "Recherche des meilleurs moments",
  refining: "Affinage des titres",
  reframing: "Recadrage intelligent",
  rendering: "Montage et sous-titres",
  retry_scheduled: "Nouvelle tentative programmée",
  done: "Terminé",
  failed: "Échec",
  cancelled: "Annulé",
  stale: "Reprise après interruption",
};

export function stageLabel(stage: string): string {
  const m = /^rendering_(\d+)_of_(\d+)$/.exec(stage);
  if (m) return `Montage du clip ${m[1]} sur ${m[2]}`;
  return STAGE_LABELS[stage] ?? stage;
}
