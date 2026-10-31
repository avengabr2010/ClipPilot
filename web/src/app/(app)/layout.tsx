import { AppShell } from "@/components/app/app-shell";
import { requireSession } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, role, entitlements } = await requireSession();
  const sb = await getServerSupabase();
  const { data: profile } = await sb.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  return (
    <AppShell user={{ email: user.email ?? "", name: profile?.full_name ?? "", role }} entitlements={entitlements}>
      {children}
    </AppShell>
  );
}
