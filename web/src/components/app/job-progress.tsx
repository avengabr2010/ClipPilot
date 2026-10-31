"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RotateCcw, X } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { stageLabel } from "@/components/app/status-badge";
import { apiFetch } from "@/lib/api-client";

export interface JobRow {
  id: string;
  type: string;
  status: string;
  progress: number;
  stage: string;
  error: string | null;
  video_id: string | null;
  clip_id: string | null;
  created_at: string;
}

const ACTIVE = ["queued", "running"];

/** Live progress of jobs (polls the DB under RLS; refreshes the page when one finishes). */
export function useLiveJobs(initial: JobRow[]) {
  const [jobs, setJobs] = useState(initial);
  const router = useRouter();
  const prev = useRef(new Map(initial.map((j) => [j.id, j.status])));
  useEffect(() => setJobs(initial), [initial]);

  useEffect(() => {
    const ids = jobs.filter((j) => ACTIVE.includes(j.status)).map((j) => j.id);
    if (ids.length === 0) return;
    const sb = getBrowserSupabase();
    let stop = false;
    const tick = async () => {
      const { data } = await sb.from("video_jobs").select("id, type, status, progress, stage, error, video_id, clip_id, created_at").in("id", ids);
      if (stop || !data) return;
      let finished = false;
      for (const j of data) {
        const before = prev.current.get(j.id);
        if (before && ACTIVE.includes(before) && !ACTIVE.includes(j.status)) {
          finished = true;
          if (j.status === "succeeded") toast.success(j.type === "render_clip" ? "Export terminé" : "Vos clips sont prêts !");
          else if (j.status === "failed") toast.error(j.error ?? "Le traitement a échoué.");
        }
        prev.current.set(j.id, j.status);
      }
      setJobs((cur) => cur.map((c) => data.find((d) => d.id === c.id) ?? c));
      if (finished) router.refresh();
    };
    const t = setInterval(tick, 2500);
    tick();
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [jobs, router]);
  return jobs;
}

export function JobProgressCard({ job, title }: { job: JobRow; title?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const active = ACTIVE.includes(job.status);
  const act = async (path: string, ok: string) => {
    setBusy(true);
    try {
      await apiFetch(path, { method: "POST" });
      toast.success(ok);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {title && <p className="truncate text-sm font-medium">{title}</p>}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {active && <Loader2 className="size-3 animate-spin" />}
            {job.status === "queued" && job.stage === "queued" ? "En file d'attente" : stageLabel(job.stage)}
          </p>
        </div>
        {active ? (
          <Button size="sm" variant="ghost" loading={busy} onClick={() => act(`/api/jobs/${job.id}/cancel`, "Traitement annulé")}>
            <X /> Annuler
          </Button>
        ) : job.status === "failed" || job.status === "cancelled" ? (
          <Button size="sm" variant="outline" loading={busy} onClick={() => act(`/api/jobs/${job.id}/retry`, "Traitement relancé")}>
            <RotateCcw /> Relancer
          </Button>
        ) : null}
      </div>
      {active && <Progress value={job.progress} className="mt-3" label="Progression du traitement" />}
      {job.status === "failed" && job.error && <p className="mt-2 text-xs text-destructive">{job.error}</p>}
    </div>
  );
}

export function LiveJobList({ initial, titles }: { initial: JobRow[]; titles: Record<string, string> }) {
  const jobs = useLiveJobs(initial);
  return (
    <div className="space-y-3">
      {jobs.map((j) => (
        <JobProgressCard key={j.id} job={j} title={titles[j.video_id ?? ""] ?? titles[j.clip_id ?? ""]} />
      ))}
    </div>
  );
}
