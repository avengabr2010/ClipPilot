import type { Metadata } from "next";
import Link from "next/link";
import { Activity, Clock, Film, FolderOpen, Plus, Sparkles, Upload } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { LiveJobList, type JobRow } from "@/components/app/job-progress";
import { formatMinutes, formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Tableau de bord" };

const EVENT_LABELS: Record<string, string> = {
  "video.uploaded": "Vidéo importée",
  "minutes.consumed": "Minutes consommées",
  "video.processed": "Vidéo analysée",
  "clip.exported": "Clip exporté",
  "clip.downloaded": "Clip téléchargé",
  "invoice.paid": "Paiement reçu",
};

export default async function DashboardPage() {
  const { user, entitlements: e } = await requireSession();
  const sb = await getServerSupabase();
  const [videos, clips, projects, jobs, activity, profile] = await Promise.all([
    sb.from("videos").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    sb.from("clips").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "ready"),
    sb.from("projects").select("id, name, created_at, videos(status), clips(count)").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5),
    sb.from("video_jobs").select("id, type, status, progress, stage, error, video_id, clip_id, created_at").eq("user_id", user.id)
      .in("status", ["queued", "running"]).order("created_at", { ascending: false }).limit(10),
    sb.from("usage_logs").select("id, event, quantity, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(8),
    sb.from("profiles").select("full_name, onboarding_completed").eq("id", user.id).single(),
  ]);

  const jobVideoIds = (jobs.data ?? []).map((j) => j.video_id).filter(Boolean) as string[];
  const { data: jobVideos } = jobVideoIds.length
    ? await sb.from("videos").select("id, original_filename").in("id", jobVideoIds)
    : { data: [] as { id: string; original_filename: string }[] };
  const titles = Object.fromEntries((jobVideos ?? []).map((v) => [v.id, v.original_filename]));
  const firstName = (profile.data?.full_name ?? "").split(" ")[0];

  const stats = [
    { label: "Vidéos importées", value: String(videos.count ?? 0), icon: Upload },
    { label: "Clips générés", value: String(clips.count ?? 0), icon: Film },
    { label: "Minutes consommées", value: formatMinutes(Number(e.minutes_used)), hint: "ce mois-ci", icon: Clock },
    {
      label: "Crédits disponibles",
      value: e.unlimited ? "Illimités" : `${formatMinutes(e.minutes_remaining)} · ${e.clips_remaining} clips`,
      icon: Sparkles,
    },
  ];

  return (
    <>
      <PageHeader
        title={firstName ? `Bonjour ${firstName}` : "Tableau de bord"}
        description="Vos vidéos, vos clips et vos traitements en cours."
        actions={
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href="/create"><Plus /> Créer mes clips</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs sm:text-sm">{s.label}</span>
                <s.icon className="size-4" />
              </div>
              <p className="mt-2 break-words font-display text-lg font-semibold sm:text-2xl">{s.value}</p>
              {s.hint && <p className="text-xs text-muted-foreground">{s.hint}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {(jobs.data?.length ?? 0) > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-base font-semibold">Traitements en cours</h2>
          <LiveJobList initial={(jobs.data ?? []) as JobRow[]} titles={titles} />
        </section>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Derniers projets</CardTitle>
            <Button asChild variant="ghost" size="sm"><Link href="/projects">Tout voir</Link></Button>
          </CardHeader>
          <CardContent>
            {projects.data?.length ? (
              <ul className="divide-y">
                {projects.data.map((p) => {
                  const status = (p.videos as { status: string }[])[0]?.status ?? "uploading";
                  const count = (p.clips as unknown as { count: number }[])[0]?.count ?? 0;
                  return (
                    <li key={p.id}>
                      <Link href={`/projects/${p.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-secondary/60">
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><FolderOpen className="size-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{p.name}</span>
                          <span className="text-xs text-muted-foreground">{count} clip{count > 1 ? "s" : ""} · {formatRelative(p.created_at)}</span>
                        </span>
                        <StatusBadge status={status} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                icon={<Upload />}
                title="Importez votre première vidéo"
                description="ClipPilot la transcrit, trouve les meilleurs moments et crée vos clips sous-titrés."
                action={<Button asChild><Link href="/create"><Plus /> Créer mes clips</Link></Button>}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Activité récente</CardTitle>
          </CardHeader>
          <CardContent>
            {activity.data?.length ? (
              <ul className="space-y-3">
                {activity.data.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 text-sm">
                    <Activity className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{EVENT_LABELS[a.event] ?? a.event}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Aucune activité pour le moment.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
