"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Captions, Scissors, Sparkles } from "lucide-react";

/**
 * Illustrative animation of the ClipPilot workflow (long video -> detected
 * moments -> vertical clips). Purely visual: no numbers are presented as
 * real statistics.
 */
const SEGMENTS = [
  { left: 8, width: 11, label: "Hook" },
  { left: 37, width: 14, label: "Anecdote" },
  { left: 68, width: 12, label: "Question" },
];
const LINES = [
  ["Le", "secret", "c'est", "la", "régularité"],
  ["Personne", "ne", "vous", "dit", "ça"],
  ["Pourquoi", "90%", "abandonnent", "?"],
];
const BARS = Array.from({ length: 72 }, (_, i) => 18 + Math.round(Math.abs(Math.sin(i * 1.7) * 48 + Math.cos(i * 0.6) * 22)));

function Phone({ line, delay, tint }: { line: string[]; delay: number; tint: string }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActive((a) => (a + 1) % line.length), 520);
    return () => clearInterval(t);
  }, [line.length]);
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: "easeOut" }}
      className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
      style={{ background: `radial-gradient(120% 80% at 50% 20%, ${tint}, #0b0a12 70%)` }}
    >
      <div className="absolute inset-x-0 top-[22%] mx-auto size-16 rounded-full bg-white/15 blur-[1px] sm:size-20" />
      <div className="absolute inset-x-0 top-[38%] mx-auto h-24 w-28 rounded-t-[48px] bg-white/10 sm:h-28 sm:w-32" />
      <div className="absolute inset-x-2 bottom-[18%] flex flex-wrap justify-center gap-x-1 text-center font-display text-[11px] font-extrabold uppercase leading-tight text-white [text-shadow:0_2px_0_#000,0_0_6px_#000] sm:text-sm">
        {line.map((w, i) => (
          <span key={i} className={i === active ? "text-[#c4b5fd]" : undefined}>
            {w}
          </span>
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
        <div className="h-full w-1/2 animate-pulse bg-primary" />
      </div>
    </motion.div>
  );
}

export function ProductDemo() {
  return (
    <div className="relative mx-auto w-full max-w-5xl">
      <div className="absolute -inset-x-10 -top-10 bottom-0 -z-10 rounded-[40px] bg-primary/10 blur-3xl" />
      <div className="rounded-2xl border bg-card/80 p-3 shadow-card backdrop-blur sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2 truncate">
            <span className="size-2.5 rounded-full bg-red-400/80" />
            <span className="size-2.5 rounded-full bg-yellow-400/80" />
            <span className="size-2.5 rounded-full bg-green-400/80" />
            <span className="ml-2 truncate">podcast-episode-12.mp4</span>
          </div>
          <span className="hidden shrink-0 sm:inline">Aperçu de l'interface</span>
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4">
            <div className="relative aspect-video overflow-hidden rounded-xl border bg-[radial-gradient(100%_100%_at_30%_20%,hsl(var(--primary)/0.35),transparent_60%),linear-gradient(135deg,#17142a,#0b0a12)]">
              <div className="absolute left-[18%] top-[24%] size-16 rounded-full bg-white/15 sm:size-24" />
              <div className="absolute left-[12%] top-[52%] h-28 w-36 rounded-t-[60px] bg-white/10 sm:w-48" />
              <div className="absolute right-[16%] top-[28%] size-14 rounded-full bg-white/10 sm:size-20" />
              <div className="absolute right-[10%] top-[52%] h-24 w-32 rounded-t-[56px] bg-white/[0.07] sm:w-40" />
              <motion.div
                className="absolute inset-y-[12%] w-[34%] rounded-lg border-2 border-primary shadow-glow"
                animate={{ left: ["10%", "56%", "10%"] }}
                transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>
            <div className="rounded-xl border bg-background/60 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium">
                <Sparkles className="size-3.5 text-primary" /> Moments détectés
              </div>
              <div className="relative flex h-14 items-center gap-[2px]">
                {BARS.map((h, i) => (
                  <div key={i} className="flex-1 rounded-full bg-muted-foreground/25" style={{ height: `${h}%` }} />
                ))}
                {SEGMENTS.map((s, i) => (
                  <motion.div
                    key={s.label}
                    initial={{ opacity: 0, scaleX: 0.3 }}
                    animate={{ opacity: 1, scaleX: 1 }}
                    transition={{ delay: 0.4 + i * 0.25, duration: 0.4 }}
                    className="absolute inset-y-0 rounded-md border border-primary/60 bg-primary/20"
                    style={{ left: `${s.left}%`, width: `${s.width}%` }}
                  >
                    <span className="absolute -top-5 left-0 whitespace-nowrap text-[10px] font-medium text-primary">{s.label}</span>
                  </motion.div>
                ))}
              </div>
            </div>
            <div className="hidden gap-2 text-xs sm:flex">
              {[
                [Scissors, "Découpe aux phrases"],
                [Captions, "Sous-titres mot à mot"],
                [Sparkles, "Recadrage 9:16"],
              ].map(([Icon, label], i) => {
                const I = Icon as typeof Scissors;
                return (
                  <span key={i} className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-muted-foreground">
                    <I className="size-3.5 text-primary" />
                    {label as string}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Phone line={LINES[0]} delay={0.6} tint="#4c1d95" />
            <Phone line={LINES[1]} delay={0.8} tint="#831843" />
            <Phone line={LINES[2]} delay={1.0} tint="#1e3a8a" />
          </div>
        </div>
      </div>
    </div>
  );
}
