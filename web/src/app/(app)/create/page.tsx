import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { CreateWizard } from "@/components/app/create-wizard";
import { PageHeader } from "@/components/app/page-header";
import { isFlagEnabled } from "@/lib/flags";

export const metadata: Metadata = { title: "Créer mes clips" };

export default async function CreatePage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { user, entitlements } = await requireSession();
  const { project } = await searchParams;
  const sb = await getServerSupabase();
  const [{ count }, { data: projects }, uploadsOpen] = await Promise.all([
    sb.from("videos").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    sb.from("projects").select("id, name").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
    isFlagEnabled("uploads"),
  ]);
  return (
    <>
      <PageHeader title="Créer mes clips" description="Importez une vidéo, choisissez vos réglages, ClipPilot fait le reste." />
      <CreateWizard
        entitlements={entitlements}
        firstTime={(count ?? 0) === 0}
        projects={projects ?? []}
        defaultProjectId={project}
        uploadsOpen={uploadsOpen || entitlements.unlimited}
      />
    </>
  );
}
