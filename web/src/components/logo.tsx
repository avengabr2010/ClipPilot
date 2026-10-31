import Link from "next/link";
import { cn } from "@/lib/utils";

/** ClipPilot mark: a play triangle cut into stacked "clips". */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <defs>
        <linearGradient id="cp-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#D946EF" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#cp-g)" />
      <path d="M12 9.5v13l10-6.5z" fill="white" />
      <rect x="7" y="9.5" width="2.2" height="13" rx="1.1" fill="white" opacity=".55" />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2 font-display text-[17px] font-semibold tracking-tight", className)}>
      <LogoMark />
      <span>ClipPilot</span>
    </Link>
  );
}
