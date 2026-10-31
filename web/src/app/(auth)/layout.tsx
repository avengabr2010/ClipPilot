import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="bg-grid absolute inset-0 -z-10" />
      <div className="glow-top absolute inset-0 -z-10" />
      <header className="container flex h-16 items-center justify-between">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center">
        <div className="w-full max-w-md rounded-2xl border bg-card/90 p-6 shadow-card backdrop-blur sm:p-8">{children}</div>
      </main>
      <footer className="pb-6 text-center text-xs text-muted-foreground">
        <Link href="/legal/terms" className="hover:text-foreground">Conditions</Link> ·{" "}
        <Link href="/legal/privacy" className="hover:text-foreground">Confidentialité</Link>
      </footer>
    </div>
  );
}
