import type { Metadata } from "next";
import { getServerSupabase } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { StatusBadge, stageLabel } from "@/components/app/status-badge";
import { RetryJobButton } from "@/components/admin/admin-buttons";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Traitements · Admin" };

export default async function AdminJobs({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const sb = await getServerSupabase();
  const filter = ["queued", "running", "failed", "succeeded", "cancelled"].includes(status ?? "") ? status! : null;
  let q = sb.from("video_jobs").select("id, type, status, stage, progress, attempts, max_attempts, error, locked_by, created_at, started_at, finished_at, heartbeat_at, user_id").order("created_at", { ascending: false }).limit(100);
  if (filter) q = q.eq("status", filter);
  const { data: jobs } = await q;
  const tabs = [["", "Toutes"], ["queued", "En attente"], ["running", "En cours"], ["failed", "Échouées"], ["succeeded", "Réussies"]];
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map(([v, l]) => (
          <a key={v} href={v ? `/admin/jobs?status=${v}` : "/admin/jobs"} className={`rounded-full border px-3 py-1 text-sm ${filter === (v || null) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"}`}>{l}</a>
        ))}
      </div>
      <div className="space-y-2">
        {(jobs ?? []).map((j) => (
          <Card key={j.id} className="p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {j.type === "process_video" ? "Analyse vidéo" : j.type === "render_clip" ? "Rendu de clip" : j.type}
                  <StatusBadge status={j.status} />
                  <span className="text-xs font-normal text-muted-foreground">tentative {j.attempts}/{j.max_attempts}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {formatDate(j.created_at, true)} · {stageLabel(j.stage)} {j.status === "running" ? `(${j.progress} %)` : ""} · worker {j.locked_by ?? "—"}
                  {j.started_at && j.finished_at ? ` · ${Math.round((new Date(j.finished_at).getTime() - new Date(j.started_at).getTime()) / 1000)} s` : ""}
                </p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{j.id} · user {j.user_id}</p>
                {j.error && <p className="mt-1 line-clamp-3 break-all font-mono text-xs text-destructive">{j.error}</p>}
              </div>
              {(j.status === "failed" || j.status === "cancelled") && <RetryJobButton id={j.id} />}
            </div>
          </Card>
        ))}
        {!jobs?.length && <p className="text-sm text-muted-foreground">Aucune tâche.</p>}
      </div>
    </>
  );
}
