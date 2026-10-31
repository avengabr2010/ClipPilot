"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Film, Loader2, MoreHorizontal, Pencil, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/app/status-badge";
import { apiFetch } from "@/lib/api-client";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ClipCardData {
  id: string;
  title: string;
  duration_seconds: number;
  virality_score: number | null;
  hook_type: string | null;
  status: string;
  aspect: string;
  thumbUrl: string | null;
  projectName?: string;
  hasExport: boolean;
}

export const HOOK_LABELS: Record<string, string> = {
  question: "Question",
  surprise: "Surprise",
  story: "Anecdote",
  bold_claim: "Affirmation forte",
  curiosity: "Curiosité",
  statistic: "Chiffre clé",
};

export function scoreColor(score: number) {
  return score >= 75 ? "text-success" : score >= 50 ? "text-primary" : "text-muted-foreground";
}

export function ClipCard({ clip }: { clip: ClipCardData }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [title, setTitle] = useState(clip.title);
  const [saving, setSaving] = useState(false);
  const busy = clip.status === "rendering" || clip.status === "pending";

  async function rename() {
    setSaving(true);
    try {
      await apiFetch(`/api/clips/${clip.id}`, { method: "PATCH", json: { title } });
      toast.success("Clip renommé");
      setRenaming(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="group overflow-hidden rounded-xl border bg-card shadow-card">
      <Link href={`/clips/${clip.id}`} className="relative block bg-black">
        <div className={cn("relative mx-auto", clip.aspect === "16:9" ? "aspect-video" : clip.aspect === "1:1" ? "aspect-square" : "aspect-[9/16] max-h-80")}>
          {clip.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={clip.thumbUrl} alt="" loading="lazy" className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-muted-foreground">
              {busy ? <Loader2 className="size-6 animate-spin" /> : <Film className="size-6" />}
            </div>
          )}
        </div>
        <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">{formatDuration(clip.duration_seconds)}</span>
        {clip.virality_score != null && (
          <span className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white" title="Score indicatif, non garanti">
            <span className={scoreColor(clip.virality_score)}>●</span> {clip.virality_score}
          </span>
        )}
      </Link>
      <div className="space-y-2 p-3">
        <div className="flex items-start gap-2">
          <Link href={`/clips/${clip.id}`} className="line-clamp-2 min-w-0 flex-1 text-sm font-medium hover:underline">{clip.title}</Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="-mr-1 -mt-1 size-8 shrink-0" aria-label="Actions du clip"><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild><Link href={`/clips/${clip.id}`}><Wand2 /> Éditer</Link></DropdownMenuItem>
              <DropdownMenuItem disabled={!clip.hasExport} asChild={clip.hasExport}>
                {clip.hasExport ? <a href={`/api/clips/${clip.id}/download`}><Download /> Télécharger</a> : <span><Download /> Télécharger</span>}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRenaming(true)}><Pencil /> Renommer</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleting(true)}><Trash2 /> Supprimer</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {clip.status !== "ready" && <StatusBadge status={clip.status} />}
          {clip.hook_type && <Badge variant="secondary">{HOOK_LABELS[clip.hook_type] ?? clip.hook_type}</Badge>}
          {clip.projectName && <span className="truncate text-xs text-muted-foreground">{clip.projectName}</span>}
        </div>
      </div>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader><DialogTitle>Renommer le clip</DialogTitle></DialogHeader>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} autoFocus onKeyDown={(e) => e.key === "Enter" && rename()} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>Annuler</Button>
            <Button loading={saving} onClick={rename} disabled={!title.trim()}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Supprimer ce clip ?"
        description="Le clip et son fichier MP4 seront définitivement supprimés. Les crédits déjà consommés ne sont pas restitués."
        confirmLabel="Supprimer"
        onConfirm={async () => {
          try {
            await apiFetch(`/api/clips/${clip.id}`, { method: "DELETE" });
            toast.success("Clip supprimé");
            router.refresh();
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    </div>
  );
}
