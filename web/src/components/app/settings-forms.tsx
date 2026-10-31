"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Monitor, Moon, Sun, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-client";
import { getBrowserSupabase } from "@/lib/supabase/client";

export function ProfileForm({ fullName, email }: { fullName: string; email: string }) {
  const [name, setName] = useState(fullName);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <Card>
      <CardHeader><CardTitle>Profil</CardTitle><CardDescription>Ces informations restent privées.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2"><Label htmlFor="email">E-mail</Label><Input id="email" value={email} disabled /></div>
        <div className="space-y-2"><Label htmlFor="name">Nom</Label><Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></div>
        <Button loading={busy} disabled={name === fullName} onClick={async () => {
          setBusy(true);
          try {
            await apiFetch("/api/account/profile", { method: "PATCH", json: { fullName: name } });
            toast.success("Profil mis à jour");
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

export function PasswordForm() {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader><CardTitle>Mot de passe</CardTitle><CardDescription>10 caractères minimum, avec lettres et chiffres.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Nouveau mot de passe" aria-label="Nouveau mot de passe" />
        <Button loading={busy} disabled={pw.length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)} onClick={async () => {
          setBusy(true);
          const { error } = await getBrowserSupabase().auth.updateUser({ password: pw });
          setBusy(false);
          if (error) toast.error("Impossible de changer le mot de passe. Reconnectez-vous puis réessayez.");
          else {
            toast.success("Mot de passe modifié");
            setPw("");
          }
        }}>Changer le mot de passe</Button>
      </CardContent>
    </Card>
  );
}

export function ThemeCard() {
  const { theme, setTheme } = useTheme();
  const opts = [["light", Sun, "Clair"], ["dark", Moon, "Sombre"], ["system", Monitor, "Système"]] as const;
  return (
    <Card>
      <CardHeader><CardTitle>Apparence</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-3 gap-2">
        {opts.map(([v, Icon, label]) => (
          <Button key={v} variant={theme === v ? "default" : "outline"} onClick={() => setTheme(v)}><Icon /> {label}</Button>
        ))}
      </CardContent>
    </Card>
  );
}

export function DeleteAccount({ isOwner }: { isOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Supprimer mon compte</CardTitle>
        <CardDescription>Supprime définitivement votre compte, vos vidéos, vos clips et annule votre abonnement. Action irréversible.</CardDescription>
      </CardHeader>
      <CardContent>
        {isOwner ? (
          <p className="text-sm text-muted-foreground">Le compte propriétaire ne peut pas être supprimé depuis l'application (voir SECURITY.md).</p>
        ) : (
          <Button variant="destructive" onClick={() => setOpen(true)}><Trash2 /> Supprimer mon compte</Button>
        )}
        <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Supprimer définitivement votre compte ?</DialogTitle>
              <DialogDescription>Tapez <strong>SUPPRIMER</strong> pour confirmer. Toutes vos données seront effacées.</DialogDescription>
            </DialogHeader>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="SUPPRIMER" aria-label="Confirmation" />
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Annuler</Button>
              <Button variant="destructive" loading={busy} disabled={confirm.trim().toUpperCase() !== "SUPPRIMER"} onClick={async () => {
                setBusy(true);
                try {
                  await apiFetch("/api/account/delete", { method: "POST", json: { confirm } });
                  window.location.assign("/?account=deleted");
                } catch (e) {
                  toast.error((e as Error).message);
                  setBusy(false);
                }
              }}>Supprimer</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
