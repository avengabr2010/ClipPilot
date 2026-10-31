import type { Metadata } from "next";
import Link from "next/link";
import { FolderOpen, Plus } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { formatDuration, formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Projets" };

export default async function ProjectsPage() {
  const { user } = await requireSession();
  const sb = await getServerSupabase();
  const { data: projects } = await sb
    .from("projects")
    .select("id, name, created_at, videos(status, duration_seconds, original_filename), clips(count)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <>
      <PageHeader title="Projets" description="Chaque vidéo importée crée un projet avec ses clips."
        actions={<Button asChild><Link href="/create"><Plus /> Nouveau projet</Link></Button>} />
      {projects?.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const vids = p.videos as { status: string; duration_seconds: number | null; original_filename: string }[];
            const count = (p.clips as unknown as { count: number }[])[0]?.count ?? 0;
            const total = vids.reduce((s, v) => s + Number(v.duration_seconds ?? 0), 0);
            return (
              <Link key={p.id} href={`/projects/${p.id}`} className="rounded-xl border bg-card p-4 shadow-card transition-colors hover:border-primary/40">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><FolderOpen className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {vids.length} vidéo{vids.length > 1 ? "s" : ""} · {total ? formatDuration(total) : "—"} · {count} clip{count > 1 ? "s" : ""}
                    </p>
                  </div>
                  {vids[0] && <StatusBadge status={vids[0].status} />}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Créé {formatRelative(p.created_at)}</p>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={<FolderOpen />} title="Aucun projet" description="Importez une vidéo pour créer votre premier projet."
          action={<Button asChild><Link href="/create"><Plus /> Créer mes clips</Link></Button>} />
      )}
    </>
  );
}
