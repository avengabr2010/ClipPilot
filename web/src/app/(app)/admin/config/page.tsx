import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { serverEnv, stripeConfigured } from "@/lib/env";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FlagSwitch } from "@/components/admin/admin-buttons";
import { formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Configuration · Admin" };

function Status({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      <div className="text-sm"><p className="font-medium">{label}</p><p className="text-xs text-muted-foreground">{hint}</p></div>
    </li>
  );
}

export default async function AdminConfig() {
  const { role, entitlements } = await requireAdmin();
  const sb = await getServerSupabase();
  const env = serverEnv();
  const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const [{ data: flags }, { data: workers }, { data: lastJob }] = await Promise.all([
    sb.from("feature_flags").select("key, enabled, description, experimental").order("key"),
    sb.from("video_jobs").select("locked_by, heartbeat_at").eq("status", "running").gte("heartbeat_at", since),
    sb.from("video_jobs").select("finished_at").eq("status", "succeeded").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const activeWorkers = new Set((workers ?? []).map((w) => w.locked_by)).size;

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Fonctionnalités</CardTitle><CardDescription>Activez ou désactivez des fonctionnalités sans redéployer.</CardDescription></CardHeader>
        <CardContent>
          <ul className="divide-y">
            {(flags ?? []).map((f) => (
              <li key={f.key} className="flex items-center justify-between gap-4 py-3">
                <div className="text-sm">
                  <p className="flex items-center gap-2 font-medium"><code>{f.key}</code>{f.experimental && <Badge variant="warning">expérimental</Badge>}</p>
                  <p className="text-xs text-muted-foreground">{f.description}</p>
                </div>
                <FlagSwitch flagKey={f.key} enabled={f.enabled} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Services</CardTitle><CardDescription>État de la configuration (aucune valeur secrète n'est affichée).</CardDescription></CardHeader>
        <CardContent>
          <ul className="divide-y">
            <Status ok label="Supabase" hint="Base de données, authentification et stockage connectés." />
            <Status ok={!!env.OWNER_EMAIL} label="OWNER_EMAIL" hint={env.OWNER_EMAIL ? "Défini côté serveur." : "Non défini : aucun compte ne peut être propriétaire."} />
            <Status ok={stripeConfigured()} label="Stripe" hint={stripeConfigured() ? "Clé secrète, secret webhook et au moins un prix configurés." : "Non configuré : les offres payantes restent fermées."} />
            <Status ok={activeWorkers > 0 || !!lastJob} label="Workers vidéo"
              hint={activeWorkers > 0 ? `${activeWorkers} worker(s) actif(s) en ce moment.` : lastJob?.finished_at ? `Aucun traitement en cours. Dernier succès ${formatRelative(lastJob.finished_at)}.` : "Aucun worker n'a encore traité de tâche. Lancez-en un (voir INSTALLATION.md)."} />
          </ul>
        </CardContent>
      </Card>

      {role === "OWNER" && (
        <Card className="border-primary/40 xl:col-span-2">
          <CardHeader>
            <CardTitle>Espace de test Premium (propriétaire)</CardTitle>
            <CardDescription>Votre compte dispose de toutes les fonctionnalités internes sans quota. Utilisez ces raccourcis pour tout tester.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button asChild><Link href="/create">Tester l'import et la génération</Link></Button>
              <Button asChild variant="outline"><Link href="/clips">Tester l'éditeur (bibliothèque)</Link></Button>
              <Button asChild variant="outline"><Link href="/billing">Voir la page Offre</Link></Button>
            </div>
            <pre className="max-h-72 overflow-auto rounded-lg bg-secondary/50 p-3 text-xs">{JSON.stringify(entitlements, null, 2)}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
