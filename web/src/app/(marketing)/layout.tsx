import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/public-env";

async function isSignedIn() {
  if (!isSupabaseConfigured) return false;
  try {
    const sb = await getServerSupabase();
    const { data } = await sb.auth.getUser();
    return Boolean(data.user);
  } catch {
    return false;
  }
}

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader signedIn={await isSignedIn()} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
