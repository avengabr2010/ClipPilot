import type { Metadata } from "next";
import { getServerSupabase } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Journaux · Admin" };

export default async function AdminLogs() {
  const sb = await getServerSupabase();
  const [{ data: logs }, { data: errors }] = await Promise.all([
    sb.from("admin_logs").select("id, action, actor_id, target_user_id, details, created_at").order("created_at", { ascending: false }).limit(100),
    sb.from("videos").select("id, original_filename, error, updated_at, user_id").eq("status", "failed").order("updated_at", { ascending: false }).limit(30),
  ]);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Actions administratives</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {(logs ?? []).map((l) => (
              <li key={l.id} className="py-2.5">
                <p className="flex justify-between gap-2"><span className="font-medium">{l.action}</span><span className="shrink-0 text-xs text-muted-foreground">{formatDate(l.created_at, true)}</span></p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">par {l.actor_id ?? "système"} → {l.target_user_id ?? "—"}</p>
                <pre className="mt-1 max-h-24 overflow-auto rounded bg-secondary/50 p-2 text-[11px]">{JSON.stringify(l.details)}</pre>
              </li>
            ))}
            {!logs?.length && <li className="py-2 text-muted-foreground">Aucune action.</li>}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Erreurs de traitement récentes</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {(errors ?? []).map((v) => (
              <li key={v.id} className="py-2.5">
                <p className="flex justify-between gap-2"><span className="truncate font-medium">{v.original_filename}</span><span className="shrink-0 text-xs text-muted-foreground">{formatDate(v.updated_at, true)}</span></p>
                <p className="text-xs text-destructive">{v.error}</p>
              </li>
            ))}
            {!errors?.length && <li className="py-2 text-muted-foreground">Aucune erreur.</li>}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Le détail technique (stack traces) est dans l'onglet Traitements et dans les logs des workers.</p>
        </CardContent>
      </Card>
    </div>
  );
}
