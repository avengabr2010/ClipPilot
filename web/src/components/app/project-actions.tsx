"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-client";

export function ProjectActions({ projectId, name }: { projectId: string; name: string }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Actions du projet"><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRenaming(true)}><Pencil /> Renommer</DropdownMenuItem>
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleting(true)}><Trash2 /> Supprimer le projet</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader><DialogTitle>Renommer le projet</DialogTitle></DialogHeader>
          <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>Annuler</Button>
            <Button loading={saving} disabled={!value.trim()} onClick={async () => {
              setSaving(true);
              try {
                await apiFetch(`/api/projects/${projectId}`, { method: "PATCH", json: { name: value } });
                setRenaming(false);
                router.refresh();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Supprimer ce projet ?"
        description="Les vidéos, transcriptions, clips et fichiers MP4 du projet seront définitivement supprimés."
        confirmLabel="Supprimer définitivement"
        onConfirm={async () => {
          try {
            await apiFetch(`/api/projects/${projectId}`, { method: "DELETE" });
            toast.success("Projet supprimé");
            router.push("/projects");
            router.refresh();
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    </>
  );
}
