import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { DeleteAccount, PasswordForm, ProfileForm, ThemeCard } from "@/components/app/settings-forms";

export const metadata: Metadata = { title: "Paramètres" };

export default async function SettingsPage() {
  const { user, role } = await requireSession();
  const sb = await getServerSupabase();
  const { data: profile } = await sb.from("profiles").select("full_name").eq("id", user.id).single();
  return (
    <>
      <PageHeader title="Paramètres" description="Gérez votre profil, votre sécurité et vos préférences." />
      <div className="grid max-w-3xl gap-6">
        <ProfileForm fullName={profile?.full_name ?? ""} email={user.email ?? ""} />
        <PasswordForm />
        <ThemeCard />
        <DeleteAccount isOwner={role === "OWNER"} />
      </div>
    </>
  );
}
