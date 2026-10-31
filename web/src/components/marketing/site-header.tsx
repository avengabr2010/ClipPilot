"use client";
import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/features", label: "Fonctionnalités" },
  { href: "/pricing", label: "Tarifs" },
  { href: "/faq", label: "FAQ" },
];

export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between gap-4">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Navigation principale">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          {signedIn ? (
            <Button asChild>
              <Link href="/dashboard">Ouvrir l'application</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost">
                <Link href="/login">Connexion</Link>
              </Button>
              <Button asChild>
                <Link href="/signup">Commencer gratuitement</Link>
              </Button>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 md:hidden">
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Menu">
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </div>
      <div className={cn("border-t border-border/60 md:hidden", open ? "block" : "hidden")}>
        <nav className="container flex flex-col gap-1 py-3" aria-label="Navigation mobile">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-3 text-base hover:bg-secondary">
              {n.label}
            </Link>
          ))}
          <div className="mt-2 grid gap-2">
            {signedIn ? (
              <Button asChild size="lg">
                <Link href="/dashboard">Ouvrir l'application</Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg">
                  <Link href="/signup">Commencer gratuitement</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/login">Connexion</Link>
                </Button>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
