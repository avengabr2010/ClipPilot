"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  ["/admin", "Vue d'ensemble"],
  ["/admin/users", "Utilisateurs"],
  ["/admin/plans", "Offres"],
  ["/admin/jobs", "Traitements"],
  ["/admin/logs", "Journaux"],
  ["/admin/config", "Configuration"],
] as const;

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="mt-2 flex gap-1 overflow-x-auto border-b scrollbar-none" aria-label="Administration">
      {TABS.map(([href, label]) => {
        const active = href === "/admin" ? path === href : path.startsWith(href);
        return (
          <Link key={href} href={href} className={cn("whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors",
            active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
