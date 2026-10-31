import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Film, Plus } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { LiveJobList, type JobRow } from "@/components/app/job-progress";
import { ClipCard } from "@/components/app/clip-card";
import { ProjectActions } from "@/components/app/project-actions";
import { CLIP_SELECT, toClipCards, type ClipRow } from "@/lib/clips-data";
import { formatBytes, formatDate, formatDuration } from "@/lib/format";
import { uuidRe } from "@/lib/api";

export const metadata: Metadata = { title: "Projet" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidRe.test(id)) notFound();
  const { user } = await requireSession();
  const sb = await getServerSupabase();
  const { data: project } = await sb.from("projects").select("id, name, created_at").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!project) notFound();

  const [{ data: videos }, { data: clips }, { data: jobs }] = await Promise.all([
    sb.from("videos").select("id, original_filename, status, error, duration_seconds, size_bytes, created_at, expires_at").eq("project_id", id).order("created_at"),
    sb.from("clips").select(CLIP_SELECT).eq("project_id", id).order("rank"),
    sb.from("video_jobs").select("id, type, status, progress, stage, error, video_id, clip_id, created_at").eq("user_id", user.id)
      .in("status", ["queued", "running", "failed"]).order("created_at", { ascending: false }).limit(20),
  ]);
  const videoIds = new Set((videos ?? []).map((v) => v.id));
  // latest process job per video
  const latest = new Map<string, JobRow>();
  for (const j of (jobs ?? []) as JobRow[]) {
    if (j.type === "process_video" && j.video_id && videoIds.has(j.video_id) && !latest.has(j.video_id)) latest.set(j.video_id, j);
  }
  const visibleJobs = [...latest.values()].filter((j) => {
    const v = videos?.find((x) => x.id === j.video_id);
    return j.status !== "failed" || v?.status === "failed";
  });
  const cards = await toClipCards((clips ?? []) as unknown as ClipRow[]);
  const titles = Object.fromEntries((videos ?? []).map((v) => [v.id, v.original_filename]));

  return (
    <>
      <PageHeader
        title={project.name}
        description={`Créé le ${formatDate(project.created_at)}`}
        actions={
          <>
            <Button asChild variant="outline"><Link href={`/create?project=${id}`}><Plus /> Ajouter une vidéo</Link></Button>
            <ProjectActions projectId={id} name={project.name} />
          </>
        }
      />
      <div className="mb-8 space-y-3">
        {(videos ?? []).map((v) => (
          <Card key={v.id}>
            <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{v.original_filename}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDuration(v.duration_seconds)} · {formatBytes(v.size_bytes)}
                  {v.expires_at && v.status === "ready" && <> · source conservée jusqu'au {formatDate(v.expires_at)}</>}
                </p>
                {v.status === "failed" && v.error && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-destructive"><AlertTriangle className="size-3.5" /> {v.error}</p>
                )}
                {v.status === "uploading" && (
                  <p className="mt-1 text-xs text-muted-foreground">Import interrompu. Relancez-le depuis « Ajouter une vidéo » avec le même fichier.</p>
                )}
              </div>
              <StatusBadge status={v.status} />
            </CardContent>
          </Card>
        ))}
        {visibleJobs.length > 0 && <LiveJobList initial={visibleJobs} titles={titles} />}
      </div>

      <h2 className="mb-3 text-base font-semibold">Clips ({cards.length})</h2>
      {cards.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {cards.map((c) => <ClipCard key={c.id} clip={c} />)}
        </div>
      ) : (
        <EmptyState icon={<Film />} title="Les clips arrivent" description="Ils apparaîtront ici dès que l'analyse sera terminée. Vous pouvez quitter cette page, le traitement continue." />
      )}
    </>
  );
}
