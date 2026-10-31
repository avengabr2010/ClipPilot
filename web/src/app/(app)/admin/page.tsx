import type { Metadata } from "next";
import { getServerSupabase } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes, formatPrice } from "@/lib/format";

export const metadata: Metadata = { title: "Administration" };

interface Stats {
  users: number; users_last_30d: number; paying_subscribers: number; videos_total: number; videos_processed: number;
  clips_total: number; clips_ready: number; minutes_processed: number; storage_bytes_exports: number; storage_bytes_sources: number;
  jobs_queued: number; jobs_running: number; jobs_failed: number; jobs_failed_24h: number; compute_seconds_30d: number; revenue_cents_recorded: number;
}

const COMPUTE_RATE = Number(process.env.COST_PER_COMPUTE_HOUR_EUR ?? "0.05");
const STORAGE_RATE = Number(process.env.COST_PER_GB_MONTH_EUR ?? "0.021");

export default async function AdminOverview() {
  const sb = await getServerSupabase();
  const { data, error } = await sb.rpc("admin_stats");
  if (error || !data) return <p className="text-sm text-destructive">Impossible de charger les statistiques : {error?.message}</p>;
  const s = data as Stats;
  const computeHours = s.compute_seconds_30d / 3600;
  const storageGb = (s.storage_bytes_exports + s.storage_bytes_sources) / 1024 ** 3;
  const estCost = computeHours * COMPUTE_RATE + storageGb * STORAGE_RATE;

  const groups: { title: string; items: [string, string, string?][] }[] = [
    { title: "Utilisateurs", items: [["Comptes", String(s.users)], ["Nouveaux (30 j)", String(s.users_last_30d)], ["Abonnés payants", String(s.paying_subscribers)]] },
    { title: "Production", items: [["Vidéos importées", String(s.videos_total)], ["Vidéos traitées", String(s.videos_processed)], ["Clips générés", String(s.clips_ready)], ["Minutes traitées", Math.round(s.minutes_processed).toLocaleString("fr-FR")]] },
    { title: "File de traitement", items: [["En attente", String(s.jobs_queued)], ["En cours", String(s.jobs_running)], ["Échecs (24 h)", String(s.jobs_failed_24h)], ["Échecs (total)", String(s.jobs_failed)]] },
    {
      title: "Ressources & finances",
      items: [
        ["Stockage", formatBytes(s.storage_bytes_exports + s.storage_bytes_sources)],
        ["Calcul (30 j)", `${computeHours.toFixed(1)} h`],
        ["Coûts estimés (30 j)", formatPrice(Math.round(estCost * 100)), `${COMPUTE_RATE} €/h de calcul + ${STORAGE_RATE} €/Go`],
        ["Revenus enregistrés", formatPrice(s.revenue_cents_recorded), "Factures payées reçues par webhook Stripe"],
      ],
    },
  ];

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.title}>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{g.title}</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {g.items.map(([label, value, hint]) => (
              <Card key={label}>
                <CardHeader className="p-4 sm:p-5">
                  <CardDescription>{label}</CardDescription>
                  <CardTitle className="font-display text-2xl">{value}</CardTitle>
                  {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>
      ))}
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          Toutes les valeurs proviennent directement de la base de données. Les coûts sont une estimation basée sur les taux configurés
          (COST_PER_COMPUTE_HOUR_EUR, COST_PER_GB_MONTH_EUR) ; les revenus ne comptent que les paiements confirmés par Stripe.
        </CardContent>
      </Card>
    </div>
  );
}
