"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditCard, Film, FolderOpen, LayoutDashboard, LogOut, Plus, Settings, Shield, Sparkles } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatMinutes } from "@/lib/format";
import type { AppRole, Entitlements } from "@/lib/entitlements";

const NAV = [
  { href: "/dashboard", label: "Tableau de bord", short: "Accueil", icon: LayoutDashboard },
  { href: "/projects", label: "Projets", short: "Projets", icon: FolderOpen },
  { href: "/clips", label: "Bibliothèque", short: "Clips", icon: Film },
  { href: "/billing", label: "Offre & crédits", short: "Offre", icon: CreditCard },
  { href: "/settings", label: "Paramètres", short: "Compte", icon: Settings },
];

export interface ShellUser {
  email: string;
  name: string;
  role: AppRole;
}

function Credits({ e }: { e: Entitlements }) {
  if (e.unlimited) {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-primary">
          <Sparkles className="size-3.5" /> Propriétaire · Premium illimité
        </div>
        <p className="mt-1 text-muted-foreground">Toutes les fonctionnalités, sans quota.</p>
      </div>
    );
  }
  const mPct = e.minutes_limit ? (Number(e.minutes_used) / e.minutes_limit) * 100 : 0;
  const cPct = e.clips_limit ? (e.clips_used / e.clips_limit) * 100 : 0;
  return (
    <Link href="/billing" className="block rounded-xl border bg-background/50 p-3 text-xs transition-colors hover:bg-secondary/60">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">Offre {e.plan.name}</span>
        {e.plan.id === "free" && <span className="text-primary">Améliorer</span>}
      </div>
      <div className="space-y-2">
        <div>
          <div className="flex justify-between text-muted-foreground">
            <span>Minutes</span>
            <span>{formatMinutes(e.minutes_remaining)} restantes</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, mPct)}%` }} />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-muted-foreground">
            <span>Clips</span>
            <span>{e.clips_remaining} restants</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, cPct)}%` }} />
          </div>
        </div>
      </div>
    </Link>
  );
}

function UserMenu({ user }: { user: ShellUser }) {
  const initials = (user.name || user.email).slice(0, 2).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-primary to-fuchsia-500 text-xs font-semibold text-white" aria-label="Menu du compte">
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <div className="truncate font-medium text-foreground">{user.name || "Mon compte"}</div>
          <div className="truncate">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings"><Settings /> Paramètres</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/billing"><CreditCard /> Offre & crédits</Link>
        </DropdownMenuItem>
        {(user.role === "OWNER" || user.role === "ADMIN") && (
          <DropdownMenuItem asChild>
            <Link href="/admin"><Shield /> Administration</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <form action="/auth/signout" method="post">
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full"><LogOut /> Se déconnecter</button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ user, entitlements, children }: { user: ShellUser; entitlements: Entitlements; children: React.ReactNode }) {
  const path = usePathname();
  const isActive = (href: string) => path === href || path.startsWith(`${href}/`);
  const admin = user.role === "OWNER" || user.role === "ADMIN";
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-card/40 p-4 lg:flex">
        <Logo href="/dashboard" className="px-2 py-1" />
        <Button asChild className="mt-6 w-full" size="lg">
          <Link href="/create"><Plus /> Créer mes clips</Link>
        </Button>
        <nav className="mt-6 flex flex-col gap-1" aria-label="Navigation de l'application">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                isActive(n.href) && "bg-secondary font-medium text-foreground",
              )}
            >
              <n.icon className="size-4" /> {n.label}
            </Link>
          ))}
          {admin && (
            <Link
              href="/admin"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                isActive("/admin") && "bg-secondary font-medium text-foreground",
              )}
            >
              <Shield className="size-4" /> Administration
              <Badge variant="outline" className="ml-auto">{user.role}</Badge>
            </Link>
          )}
        </nav>
        <div className="mt-auto space-y-3">
          <Credits e={entitlements} />
          <div className="flex items-center justify-between">
            <UserMenu user={user} />
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-xl lg:hidden">
          <Logo href="/dashboard" />
          <div className="flex items-center gap-1">
            {admin && (
              <Button asChild variant="ghost" size="icon" aria-label="Administration">
                <Link href="/admin"><Shield /></Link>
              </Button>
            )}
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">{children}</main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 backdrop-blur-xl lg:hidden" aria-label="Navigation mobile">
        <div className="grid grid-cols-5 items-end">
          {NAV.slice(0, 2).map((n) => (
            <MobileTab key={n.href} {...n} active={isActive(n.href)} />
          ))}
          <div className="flex justify-center">
            <Link
              href="/create"
              aria-label="Créer mes clips"
              className="-mt-5 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-glow active:scale-95"
            >
              <Plus className="size-6" />
            </Link>
          </div>
          {NAV.slice(2, 4).map((n) => (
            <MobileTab key={n.href} {...n} active={isActive(n.href)} />
          ))}
        </div>
      </nav>
    </div>
  );
}

function MobileTab({ href, short, icon: Icon, active }: { href: string; short: string; icon: typeof Plus; active: boolean }) {
  return (
    <Link href={href} className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px]", active ? "text-primary" : "text-muted-foreground")}>
      <Icon className="size-5" />
      {short}
    </Link>
  );
}
