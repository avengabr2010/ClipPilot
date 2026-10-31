import type { Metadata } from "next";
import { getServerSupabase } from "@/lib/supabase/server";
import { PlanEditor, type AdminPlan } from "@/components/admin/plan-editor";

export const metadata: Metadata = { title: "Offres · Admin" };

export default async function AdminPlans() {
  const sb = await getServerSupabase();
  const { data } = await sb.from("plans").select("*").order("sort_order");
  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">Les limites s'appliquent immédiatement à tous les abonnés de l'offre. Le prix affiché doit correspondre au prix Stripe associé.</p>
      <div className="grid gap-4 xl:grid-cols-3">
        {(data ?? []).map((p) => <PlanEditor key={p.id} plan={p as AdminPlan} />)}
      </div>
    </>
  );
}
