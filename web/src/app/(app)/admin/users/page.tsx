import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UserActions } from "@/components/admin/user-actions";
import { formatDate, formatMinutes } from "@/lib/format";

export const metadata: Metadata = { title: "Utilisateurs · Admin" };

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { q, page } = await searchParams;
  const { user: me, role } = await requireAdmin();
  const sb = await getServerSupabase();
  const p = Math.max(0, Number(page ?? 0) || 0);
  let query = sb.from("profiles").select("id, email, full_name, created_at", { count: "exact" }).order("created_at", { ascending: false }).range(p * 50, p * 50 + 49);
  if (q) query = query.ilike("email", `%${q.replace(/[%_\\]/g, (m) => `\\${m}`).slice(0, 80)}%`);
  const { data: profiles, count } = await query;
  const ids = (profiles ?? []).map((u) => u.id);
  const [{ data: roles }, { data: subs }, { data: bals }, { data: plans }] = await Promise.all([
    sb.from("user_roles").select("user_id, role").in("user_id", ids),
    sb.from("subscriptions").select("user_id, plan_id, status, stripe_subscription_id").in("user_id", ids),
    sb.from("credit_balances").select("user_id, minutes_used, clips_used, bonus_minutes, bonus_clips").in("user_id", ids),
    sb.from("plans").select("id, name").order("sort_order"),
  ]);
  const by = <T extends { user_id: string }>(rows: T[] | null) => new Map((rows ?? []).map((r) => [r.user_id, r]));
  const R = by(roles), S = by(subs), B = by(bals);

  return (
    <>
      <form className="mb-4 flex gap-2" action="/admin/users">
        <Input name="q" defaultValue={q} placeholder="Rechercher par e-mail…" aria-label="Rechercher un utilisateur" />
        <Button type="submit" variant="secondary">Rechercher</Button>
      </form>
      <p className="mb-3 text-sm text-muted-foreground">{count ?? 0} utilisateur(s)</p>
      <div className="space-y-2">
        {(profiles ?? []).map((u) => {
          const r = R.get(u.id)?.role ?? "USER";
          const s = S.get(u.id);
          const b = B.get(u.id);
          return (
            <Card key={u.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <span className="truncate">{u.email}</span>
                  <Badge variant={r === "OWNER" ? "default" : r === "ADMIN" ? "warning" : "outline"}>{r}</Badge>
                  <Badge variant="secondary">{s?.plan_id ?? "free"}{s?.stripe_subscription_id ? " · Stripe" : ""}</Badge>
                </p>
                <p className="text-xs text-muted-foreground">
                  {u.full_name || "—"} · inscrit le {formatDate(u.created_at)} · {formatMinutes(Number(b?.minutes_used ?? 0))} et {b?.clips_used ?? 0} clips ce mois
                  {(b?.bonus_minutes || b?.bonus_clips) ? ` · bonus +${b?.bonus_minutes} min / +${b?.bonus_clips} clips` : ""}
                </p>
              </div>
              <UserActions user={{ id: u.id, email: u.email, role: r, plan: s?.plan_id ?? "free" }} plans={plans ?? []} actorIsOwner={role === "OWNER"} actorId={me.id} />
            </Card>
          );
        })}
      </div>
      <div className="mt-4 flex justify-between">
        {p > 0 ? <Button asChild variant="outline"><Link href={`/admin/users?page=${p - 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>Précédent</Link></Button> : <span />}
        {(count ?? 0) > (p + 1) * 50 && <Button asChild variant="outline"><Link href={`/admin/users?page=${p + 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>Suivant</Link></Button>}
      </div>
    </>
  );
}
