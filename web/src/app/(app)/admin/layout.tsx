import { requireAdmin } from "@/lib/auth";
import { AdminNav } from "@/components/admin/admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { role } = await requireAdmin();
  return (
    <>
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wider text-primary">Administration · {role}</p>
        <AdminNav />
      </div>
      {children}
    </>
  );
}
