import type { Metadata } from "next";
import Link from "next/link";
import { Film, Plus } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { ClipCard } from "@/components/app/clip-card";
import { LibraryFilters } from "@/components/app/library-filters";
import { CLIP_SELECT, toClipCards, type ClipRow } from "@/lib/clips-data";
import { uuidRe } from "@/lib/api";

export const metadata: Metadata = { title: "Bibliothèque" };

const SORTS: Record<string, { col: string; asc: boolean }> = {
  date: { col: "created_at", asc: false },
  date_asc: { col: "created_at", asc: true },
  duration: { col: "duration_seconds", asc: false },
  duration_asc: { col: "duration_seconds", asc: true },
  score: { col: "virality_score", asc: false },
};

export default async function ClipsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { user } = await requireSession();
  const sb = await getServerSupabase();
  const sort = SORTS[sp.sort ?? "date"] ?? SORTS.date;
  let query = sb.from("clips").select(CLIP_SELECT).eq("user_id", user.id);
  if (sp.q) query = query.ilike("title", `%${sp.q.replace(/[%_\\]/g, (m) => `\\${m}`).slice(0, 80)}%`);
  if (sp.project && uuidRe.test(sp.project)) query = query.eq("project_id", sp.project);
  if (sp.status && ["ready", "rendering", "failed", "pending"].includes(sp.status)) query = query.eq("status", sp.status);
  query = query.order(sort.col, { ascending: sort.asc, nullsFirst: false }).limit(120);

  const [{ data: clips }, { data: projects }, { count: total }] = await Promise.all([
    query,
    sb.from("projects").select("id, name").eq("user_id", user.id).order("created_at", { ascending: false }),
    sb.from("clips").select("id", { count: "exact", head: true }).eq("user_id", user.id),
  ]);
  const cards = await toClipCards((clips ?? []) as unknown as ClipRow[], true);

  return (
    <>
      <PageHeader title="Bibliothèque" description={`${total ?? 0} clip${(total ?? 0) > 1 ? "s" : ""} au total`}
        actions={<Button asChild><Link href="/create"><Plus /> Créer mes clips</Link></Button>} />
      {(total ?? 0) > 0 && <LibraryFilters projects={projects ?? []} />}
      {cards.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {cards.map((c) => <ClipCard key={c.id} clip={c} />)}
        </div>
      ) : (total ?? 0) > 0 ? (
        <EmptyState icon={<Film />} title="Aucun résultat" description="Aucun clip ne correspond à ces filtres." />
      ) : (
        <EmptyState icon={<Film />} title="Votre bibliothèque est vide" description="Vos clips apparaîtront ici après votre premier import."
          action={<Button asChild><Link href="/create"><Plus /> Créer mes clips</Link></Button>} />
      )}
    </>
  );
}
