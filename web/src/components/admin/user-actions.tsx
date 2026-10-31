"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Coins, Crown, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-client";

export function UserActions({ user, plans, actorIsOwner, actorId }: {
  user: { id: string; email: string; role: string; plan: string };
  plans: { id: string; name: string }[];
  actorIsOwner: boolean;
  actorId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<null | "credits" | "plan" | "role">(null);
  const [minutes, setMinutes] = useState(0);
  const [clips, setClips] = useState(0);
  const [note, setNote] = useState("");
  const [plan, setPlan] = useState(user.plan);
  const [role, setRole] = useState(user.role === "ADMIN" ? "ADMIN" : "USER");
  const [busy, setBusy] = useState(false);
  const isOwnerTarget = user.role === "OWNER";

  const run = async (path: string, json: unknown, ok: string) => {
    setBusy(true);
    try {
      await apiFetch(path, { method: "POST", json });
      toast.success(ok);
      setOpen(null);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="outline" onClick={() => setOpen("credits")} disabled={isOwnerTarget}><Coins /> Crédits</Button>
      <Button size="sm" variant="outline" onClick={() => setOpen("plan")} disabled={isOwnerTarget}><Settings2 /> Offre</Button>
      {actorIsOwner && !isOwnerTarget && user.id !== actorId && (
        <Button size="sm" variant="outline" onClick={() => setOpen("role")}><Crown /> Rôle</Button>
      )}

      <Dialog open={open === "credits"} onOpenChange={(o) => setOpen(o ? "credits" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Offrir des crédits</DialogTitle>
            <DialogDescription>{user.email} — valables jusqu'à la fin de la période en cours. Action journalisée.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Minutes</Label><Input type="number" min={0} value={minutes} onChange={(e) => setMinutes(Math.max(0, Number(e.target.value)))} /></div>
            <div className="space-y-2"><Label>Clips</Label><Input type="number" min={0} value={clips} onChange={(e) => setClips(Math.max(0, Number(e.target.value)))} /></div>
          </div>
          <div className="space-y-2"><Label>Motif</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Geste commercial, support…" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>Annuler</Button>
            <Button loading={busy} disabled={(!minutes && !clips) || note.trim().length < 3}
              onClick={() => run(`/api/admin/users/${user.id}/credits`, { minutes, clips, note }, "Crédits ajoutés")}>Ajouter</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "plan"} onOpenChange={(o) => setOpen(o ? "plan" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Changer l'offre</DialogTitle>
            <DialogDescription>Attribution manuelle (comptes offerts, support). Les abonnements Stripe se gèrent dans Stripe.</DialogDescription>
          </DialogHeader>
          <NativeSelect value={plan} onChange={(e) => setPlan(e.target.value)}>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>Annuler</Button>
            <Button loading={busy} onClick={() => run(`/api/admin/users/${user.id}/plan`, { planId: plan }, "Offre mise à jour")}>Appliquer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "role"} onOpenChange={(o) => setOpen(o ? "role" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rôle de {user.email}</DialogTitle>
            <DialogDescription>Un ADMIN accède à l'administration mais ne peut pas gérer les rôles. Le rôle OWNER n'est jamais attribuable.</DialogDescription>
          </DialogHeader>
          <NativeSelect value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="USER">USER</option>
            <option value="ADMIN">ADMIN</option>
          </NativeSelect>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>Annuler</Button>
            <Button loading={busy} onClick={() => run(`/api/admin/users/${user.id}/role`, { role }, "Rôle mis à jour")}>Appliquer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
