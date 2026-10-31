"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle, Captions, Crop, Download, Eye, Gauge, Loader2, Lock, Magnet, Pause, Play, RotateCcw, Save, Scissors, Sparkles, Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Tip } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatBytes, formatTimecode } from "@/lib/format";
import { hasFeature, type Entitlements } from "@/lib/entitlements";
import { ASPECTS } from "@/lib/generation";
import { canUsePreset, FONTS, getPreset, SUBTITLE_PRESETS, type SubtitleStyle } from "@/lib/presets";
import { stageLabel } from "@/components/app/status-badge";
import { HOOK_LABELS, scoreColor } from "@/components/app/clip-card";
import { useLiveJobs, type JobRow } from "@/components/app/job-progress";

type Aspect = (typeof ASPECTS)[number];
interface Word { start: number; end: number; text: string }
interface CropState { mode: "auto" | "manual" | "center"; x?: number; zoom?: number; keyframes?: { t: number; x: number }[] | null }

export interface EditorClip {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  originalStart: number;
  originalEnd: number;
  transcript: string;
  reason: string;
  hookType: string | null;
  hookText: string | null;
  viralityScore: number | null;
  breakdown: Record<string, number>;
  status: string;
  error: string | null;
  video: { duration: number; width: number; height: number; expired: boolean };
  edit: { start: number; end: number; aspect: Aspect; resolution: 720 | 1080; template: string; style: SubtitleStyle; subtitlesEnabled: boolean; crop: CropState };
  words: Word[];
  exportInfo: { width: number; height: number; size: number; duration: number; createdAt: string; watermark: boolean } | null;
}

const BREAKDOWN_LABELS: Record<string, string> = {
  hook: "Début", coherence: "Cohérence", interest: "Intérêt", context: "Autonomie", rhythm: "Rythme", audio: "Audio", length: "Longueur", llm: "Avis IA",
};
const MIN_LEN = 3;
const MAX_LEN = 180;
const ratio = (a: Aspect) => (a === "9:16" ? 9 / 16 : a === "1:1" ? 1 : 16 / 9);

function groupWords(words: Word[], perLine: number): Word[][] {
  const groups: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    if (cur.length && (cur.length >= perLine || w.start - cur[cur.length - 1].end > 0.6)) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
    if (/[.?!]$/.test(w.text) && cur.length >= 2) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

function keyframeX(kf: { t: number; x: number }[] | null | undefined, t: number): number {
  if (!kf?.length) return 0.5;
  let x = kf[0].x;
  for (let i = 1; i < kf.length; i++) {
    if (t < kf[i].t) break;
    const p = Math.min(1, (t - kf[i].t) / 0.5);
    const e = 3 * p * p - 2 * p * p * p;
    x = kf[i - 1].x + (kf[i].x - kf[i - 1].x) * e;
    if (p >= 1) x = kf[i].x;
  }
  return x;
}

export function ClipEditor({ clip, entitlements: ent, lastJob }: { clip: EditorClip; entitlements: Entitlements; lastJob: JobRow | null }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [media, setMedia] = useState<{ sourceUrl: string | null; exportUrl: string | null } | null>(null);
  const [start, setStart] = useState(clip.edit.start);
  const [end, setEnd] = useState(clip.edit.end);
  const [aspect, setAspect] = useState<Aspect>(clip.edit.aspect);
  const [resolution, setResolution] = useState<720 | 1080>(Math.min(clip.edit.resolution, ent.max_resolution) as 720 | 1080);
  const [template, setTemplate] = useState(clip.edit.template);
  const [style, setStyle] = useState<SubtitleStyle>(clip.edit.style);
  const [subsOn, setSubsOn] = useState(clip.edit.subtitlesEnabled);
  const [crop, setCrop] = useState<CropState>(clip.edit.crop);
  const [words, setWords] = useState<Word[]>(clip.words);
  const [tab, setTab] = useState<"trim" | "subs" | "format" | "insights">("trim");
  const [time, setTime] = useState(clip.edit.start);
  const [playing, setPlaying] = useState(false);
  const [frameH, setFrameH] = useState(640);
  const [showExport, setShowExport] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const jobs = useLiveJobs(useMemo(() => (lastJob ? [lastJob] : []), [lastJob]));
  const job = jobs[0];
  const rendering = job && ["queued", "running"].includes(job.status);
  const customSubs = hasFeature(ent, "custom_subtitles");

  const mark = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setDirty(true);
  };

  useEffect(() => {
    apiFetch<{ sourceUrl: string | null; exportUrl: string | null }>(`/api/clips/${clip.id}/media`)
      .then(setMedia)
      .catch(() => setMedia({ sourceUrl: null, exportUrl: null }));
  }, [clip.id, clip.exportInfo?.createdAt]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setFrameH(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // keep playback inside [start, end]
  const onTime = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.currentTime >= end || v.currentTime < start - 0.5) {
      v.currentTime = start;
      if (v.currentTime >= end) v.pause();
    }
    setTime(v.currentTime);
  }, [start, end]);

  const seek = (t: number) => {
    const v = videoRef.current;
    const clamped = Math.max(0, Math.min(clip.video.duration, t));
    if (v) v.currentTime = clamped;
    setTime(clamped);
  };
  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < start || v.currentTime >= end - 0.05) v.currentTime = start;
      void v.play();
    } else v.pause();
  };

  // ---- derived preview geometry ----
  const srcAspect = clip.video.width / clip.video.height;
  const tgt = ratio(aspect);
  const zoom = crop.mode === "manual" ? crop.zoom ?? 1 : 1;
  const cx = crop.mode === "manual" ? crop.x ?? 0.5 : crop.mode === "auto" ? keyframeX(crop.keyframes, time - clip.originalStart) : 0.5;
  let vw = 100 * zoom, vh = 100 * zoom, left = (100 - vw) / 2, top = (100 - vh) / 2;
  if (srcAspect > tgt) {
    vw = (100 / (tgt / srcAspect)) * zoom;
    left = Math.min(0, Math.max(100 - vw, 50 - cx * vw));
  } else {
    vh = (100 / (srcAspect / tgt)) * zoom;
    top = (100 - vh) / 2;
  }

  // ---- subtitles in range ----
  const clipWords = useMemo(() => words.filter((w) => w.end > start && w.start < end), [words, start, end]);
  const groups = useMemo(() => groupWords(clipWords, style.wordsPerLine), [clipWords, style.wordsPerLine]);
  const activeGroup = groups.find((g) => time >= g[0].start && time <= g[g.length - 1].end + 0.05);

  const updateGroupText = (gi: number, text: string) => {
    const g = groups[gi];
    const tokens = text.split(/\s+/).filter(Boolean);
    const span = { a: g[0].start, b: g[g.length - 1].end };
    let replacement: Word[];
    if (tokens.length === g.length) replacement = g.map((w, i) => ({ ...w, text: tokens[i] }));
    else {
      const step = (span.b - span.a) / Math.max(1, tokens.length);
      replacement = tokens.map((t, i) => ({ start: span.a + i * step, end: span.a + (i + 1) * step - 0.02, text: t.slice(0, 64) }));
    }
    setWords((all) => [...all.filter((w) => w.end <= span.a || w.start >= span.b), ...replacement].sort((x, y) => x.start - y.start));
    setDirty(true);
  };

  // ---- timeline window ----
  const winA = Math.max(0, Math.min(start, clip.originalStart) - 20);
  const winB = Math.min(clip.video.duration, Math.max(end, clip.originalEnd) + 20);
  const len = end - start;
  const lenOk = len >= MIN_LEN && len <= MAX_LEN;

  const payload = () => ({
    start: Math.round(start * 1000) / 1000,
    end: Math.round(end * 1000) / 1000,
    aspect,
    resolution,
    template,
    subtitlesEnabled: subsOn,
    style,
    words: words.filter((w) => w.end > start - 5 && w.start < end + 5),
    crop: { mode: crop.mode, x: crop.x, zoom: crop.zoom },
  });

  async function save(silent = false) {
    if (!lenOk) {
      toast.error(`Le clip doit durer entre ${MIN_LEN} et ${MAX_LEN} secondes.`);
      return false;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/clips/${clip.id}/edit`, { method: "PUT", json: payload() });
      setDirty(false);
      if (!silent) toast.success("Modifications enregistrées");
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function exportClip() {
    if (!(await save(true))) return;
    try {
      await apiFetch(`/api/clips/${clip.id}/render`, { method: "POST" });
      toast.success("Export lancé. Vous pouvez quitter la page, il continue en arrière-plan.");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const preset = getPreset(template);
  const fontFamily = style.font === "JetBrains Mono" ? "ui-monospace, monospace" : style.font === "DejaVu Sans" || style.font === "Liberation Sans" ? "Arial, sans-serif" : "var(--font-sans), Inter, sans-serif";
  const px = style.size * frameH;
  const outlinePx = (style.outlineWidth * frameH) / 1280;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr] xl:grid-cols-[minmax(0,460px)_1fr]">
      {/* ---------------- Preview ---------------- */}
      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="mx-auto w-full" style={{ maxWidth: aspect === "9:16" ? "min(100%, 46dvh)" : "100%" }}>
          <div
            ref={frameRef}
            className="relative w-full touch-none select-none overflow-hidden rounded-2xl bg-black shadow-card"
            style={{ aspectRatio: aspect.replace(":", " / ") }}
            onPointerDown={(e) => {
              if (crop.mode !== "manual" || showExport) return;
              const el = e.currentTarget;
              el.setPointerCapture(e.pointerId);
              const startX = e.clientX;
              const x0 = crop.x ?? 0.5;
              const w = el.getBoundingClientRect().width;
              const move = (ev: PointerEvent) => {
                const dx = (ev.clientX - startX) / ((w * vw) / 100);
                setCrop((c) => ({ ...c, x: Math.max(0, Math.min(1, x0 - dx)) }));
                setDirty(true);
              };
              const up = () => {
                el.removeEventListener("pointermove", move);
                el.removeEventListener("pointerup", up);
              };
              el.addEventListener("pointermove", move);
              el.addEventListener("pointerup", up);
            }}
          >
            {showExport && media?.exportUrl ? (
              <video key="export" src={media.exportUrl} className="absolute inset-0 size-full object-contain" controls playsInline autoPlay />
            ) : media?.sourceUrl ? (
              <>
                <video
                  ref={videoRef}
                  src={`${media.sourceUrl}#t=${start}`}
                  className="absolute max-w-none"
                  style={{ width: `${vw}%`, height: `${vh}%`, left: `${left}%`, top: `${top}%`, objectFit: "fill", transition: crop.mode === "auto" ? "left 120ms linear" : undefined }}
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={() => seek(start)}
                  onTimeUpdate={onTime}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                />
                {subsOn && activeGroup && (
                  <div
                    className={cn("pointer-events-none absolute inset-x-[8%] flex justify-center text-center",
                      style.position === "top" ? "top-[12%]" : style.position === "middle" ? "top-1/2 -translate-y-1/2" : "bottom-[12%]")}
                  >
                    <span
                      className="inline-block rounded-md px-[0.3em] py-[0.1em] leading-tight"
                      style={{
                        fontFamily, fontSize: px, fontWeight: style.weight, color: style.color,
                        textTransform: style.uppercase ? "uppercase" : undefined,
                        background: style.background ? `${style.backgroundColor}cc` : undefined,
                        WebkitTextStroke: !style.background && outlinePx ? `${outlinePx}px ${style.outlineColor}` : undefined,
                        paintOrder: "stroke fill",
                        textShadow: style.background ? undefined : "0 2px 6px rgb(0 0 0 / .5)",
                      }}
                    >
                      {activeGroup.map((w, i) => {
                        const active = time >= w.start && time < (activeGroup[i + 1]?.start ?? w.end + 0.3);
                        const sung = style.animation === "karaoke" && time >= w.start;
                        const kw = style.animation === "none" && style.highlightKeywords && (/\d/.test(w.text) || w.text.length >= 7);
                        const hi = ((style.animation === "word" || style.animation === "pop") && active) || sung || kw;
                        return (
                          <span key={`${w.start}-${i}`} style={{ color: hi ? style.highlightColor : undefined, display: "inline-block",
                            transform: style.animation === "pop" && active ? "scale(1.12)" : undefined, transition: "transform 90ms" }}>
                            {w.text}{i < activeGroup.length - 1 ? " " : ""}
                          </span>
                        );
                      })}
                    </span>
                  </div>
                )}
                {ent.watermark && <span className="pointer-events-none absolute right-[4%] top-[3%] text-[10px] font-semibold text-white/60">Créé avec ClipPilot</span>}
                {crop.mode === "manual" && <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">Glissez pour recadrer</span>}
              </>
            ) : (
              <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/70">
                {media === null ? <Loader2 className="size-6 animate-spin" /> : clip.video.expired ? "La vidéo source a expiré : l'aperçu en direct n'est plus disponible." : "Aperçu indisponible."}
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {!showExport && (
            <Button variant="secondary" onClick={toggle} disabled={!media?.sourceUrl} aria-label={playing ? "Pause" : "Lecture"}>
              {playing ? <Pause /> : <Play />} {playing ? "Pause" : "Lire"}
            </Button>
          )}
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {formatTimecode(Math.max(0, time - start))} / {formatTimecode(len)}
          </span>
          {media?.exportUrl && (
            <Button variant="ghost" size="sm" onClick={() => setShowExport((s) => !s)}>
              <Eye /> {showExport ? "Aperçu d'édition" : "Voir l'export final"}
            </Button>
          )}
        </div>
      </div>

      {/* ---------------- Controls ---------------- */}
      <div className="min-w-0 space-y-4">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">{clip.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {clip.viralityScore != null && (
              <Tip content="Score indicatif calculé à partir du contenu. Ce n'est pas une garantie de viralité.">
                <Badge variant="secondary" className="cursor-help"><Gauge className="size-3" /> Score {clip.viralityScore}/100</Badge>
              </Tip>
            )}
            {clip.hookType && <Badge><Magnet className="size-3" /> Hook : {HOOK_LABELS[clip.hookType] ?? clip.hookType}</Badge>}
            {dirty && <Badge variant="warning">Modifications non enregistrées</Badge>}
          </div>
        </div>

        {rendering && job && (
          <Card><CardContent className="space-y-2 p-4">
            <p className="flex items-center gap-2 text-sm font-medium"><Loader2 className="size-4 animate-spin text-primary" /> {stageLabel(job.stage)}</p>
            <Progress value={job.progress} label="Progression de l'export" />
          </CardContent></Card>
        )}
        {job?.status === "failed" && !rendering && (
          <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Dernier export échoué : {job.error ?? "erreur inconnue"}
          </p>
        )}

        <div className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1 scrollbar-none" role="tablist">
          {([
            ["trim", Scissors, "Découpe"],
            ["subs", Captions, "Sous-titres"],
            ["format", Crop, "Format"],
            ["insights", Sparkles, "Analyse"],
          ] as const).map(([k, Icon, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={cn("flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors",
                tab === k ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>

        <Card>
          <CardContent className="space-y-5 p-4 sm:p-6">
            {tab === "trim" && (
              <>
                <div>
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span>{formatTimecode(winA)}</span>
                    <span className={cn("font-medium", lenOk ? "text-foreground" : "text-destructive")}>Durée : {len.toFixed(1)} s</span>
                    <span>{formatTimecode(winB)}</span>
                  </div>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-x-0 top-1/2 h-6 -translate-y-1/2">
                      {clipWords.concat(words.filter((w) => w.start >= winA && w.end <= winB && (w.end <= start || w.start >= end))).map((w, i) => (
                        <span key={i} className="absolute top-0 h-full w-px bg-muted-foreground/25" style={{ left: `${((w.start - winA) / (winB - winA)) * 100}%` }} />
                      ))}
                      <span className="absolute top-[-6px] h-[calc(100%+12px)] w-0.5 rounded bg-foreground" style={{ left: `${((time - winA) / (winB - winA)) * 100}%` }} />
                    </div>
                    <Slider min={winA} max={winB} step={0.1} value={[start, end]} minStepsBetweenThumbs={MIN_LEN * 10} thumbLabels={["Début", "Fin"]}
                      onValueChange={([a, b]) => {
                        if (a !== start) seek(a);
                        else if (b !== end) seek(Math.max(a, b - 2));
                        setStart(a);
                        setEnd(b);
                        setDirty(true);
                      }} />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {([["Début", start, setStart], ["Fin", end, setEnd]] as const).map(([label, val, setter]) => (
                    <div key={label} className="rounded-lg border p-3">
                      <Label>{label}</Label>
                      <p className="my-1 font-mono text-lg tabular-nums">{formatTimecode(val)}</p>
                      <div className="flex gap-1">
                        {[-1, -0.1, 0.1, 1].map((d) => (
                          <Button key={d} size="sm" variant="outline" className="flex-1 px-0"
                            onClick={() => { const v = Math.max(0, Math.min(clip.video.duration, val + d)); mark(setter)(v); seek(label === "Début" ? v : Math.max(start, v - 2)); }}>
                            {d > 0 ? "+" : ""}{d}s
                          </Button>
                        ))}
                      </div>
                      <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={() => { mark(setter)(Math.round(time * 10) / 10); }}>
                        Placer à la tête de lecture
                      </Button>
                    </div>
                  ))}
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setStart(clip.originalStart); setEnd(clip.originalEnd); setDirty(true); seek(clip.originalStart); }}>
                  <RotateCcw /> Revenir à la sélection de l'IA
                </Button>
              </>
            )}

            {tab === "subs" && (
              <>
                <label className="flex items-center justify-between gap-3 text-sm font-medium">
                  Afficher les sous-titres <Switch checked={subsOn} onCheckedChange={mark(setSubsOn)} />
                </label>
                <div>
                  <Label>Modèle</Label>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {SUBTITLE_PRESETS.map((p) => {
                      const ok = canUsePreset(ent, p);
                      return (
                        <button key={p.id} disabled={!ok} onClick={() => { setTemplate(p.id); setStyle(p.style); setDirty(true); }}
                          className={cn("rounded-lg border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50",
                            template === p.id ? "border-primary bg-primary/10" : "hover:bg-secondary")}>
                          <span className="flex items-center justify-between">{p.name}{!ok && <Lock className="size-3.5" />}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {customSubs ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Police</Label>
                      <NativeSelect value={style.font} onChange={(e) => mark(setStyle)({ ...style, font: e.target.value })}>
                        {FONTS.map((f) => <option key={f}>{f}</option>)}
                      </NativeSelect>
                    </div>
                    <div className="space-y-2">
                      <Label>Animation</Label>
                      <NativeSelect value={style.animation} onChange={(e) => mark(setStyle)({ ...style, animation: e.target.value as SubtitleStyle["animation"] })}>
                        <option value="none">Aucune</option><option value="word">Mot actif</option><option value="karaoke">Karaoké</option><option value="pop">Pop</option>
                      </NativeSelect>
                    </div>
                    <div className="space-y-1">
                      <Label>Taille ({Math.round(style.size * 1000) / 10} %)</Label>
                      <Slider min={0.025} max={0.09} step={0.001} value={[style.size]} onValueChange={([v]) => mark(setStyle)({ ...style, size: v })} thumbLabels={["Taille"]} />
                    </div>
                    <div className="space-y-1">
                      <Label>Mots par ligne ({style.wordsPerLine})</Label>
                      <Slider min={1} max={8} step={1} value={[style.wordsPerLine]} onValueChange={([v]) => mark(setStyle)({ ...style, wordsPerLine: v })} thumbLabels={["Mots par ligne"]} />
                    </div>
                    <div className="space-y-1">
                      <Label>Contour ({style.outlineWidth})</Label>
                      <Slider min={0} max={8} step={0.5} value={[style.outlineWidth]} onValueChange={([v]) => mark(setStyle)({ ...style, outlineWidth: v })} thumbLabels={["Contour"]} />
                    </div>
                    <div className="space-y-2">
                      <Label>Position</Label>
                      <div className="grid grid-cols-3 gap-1">
                        {(["top", "middle", "bottom"] as const).map((p) => (
                          <Button key={p} size="sm" variant={style.position === p ? "default" : "outline"} onClick={() => mark(setStyle)({ ...style, position: p })}>
                            {p === "top" ? "Haut" : p === "middle" ? "Centre" : "Bas"}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 sm:col-span-2">
                      {([["color", "Texte"], ["highlightColor", "Mot actif"], ["outlineColor", "Contour"], ["backgroundColor", "Fond"]] as const).map(([k, label]) => (
                        <label key={k} className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                          <input type="color" value={style[k]} onChange={(e) => mark(setStyle)({ ...style, [k]: e.target.value.toUpperCase() })}
                            className="h-10 w-full cursor-pointer rounded-lg border bg-transparent p-1" aria-label={label} />
                          {label}
                        </label>
                      ))}
                    </div>
                    <label className="flex items-center justify-between gap-2 text-sm">Fond derrière le texte <Switch checked={style.background} onCheckedChange={(v) => mark(setStyle)({ ...style, background: v })} /></label>
                    <label className="flex items-center justify-between gap-2 text-sm">Majuscules <Switch checked={style.uppercase} onCheckedChange={(v) => mark(setStyle)({ ...style, uppercase: v })} /></label>
                    <label className="flex items-center justify-between gap-2 text-sm sm:col-span-2">Mettre en évidence les mots importants <Switch checked={style.highlightKeywords} onCheckedChange={(v) => mark(setStyle)({ ...style, highlightKeywords: v })} /></label>
                  </div>
                ) : (
                  <p className="flex items-center gap-2 rounded-lg border bg-secondary/40 p-3 text-xs text-muted-foreground">
                    <Lock className="size-3.5" /> La personnalisation complète du style est incluse dès l'offre Starter.
                  </p>
                )}
                <div>
                  <Label>Texte ({groups.length} lignes)</Label>
                  <p className="mb-2 text-xs text-muted-foreground">Corrigez une ligne : le timing est conservé. Touchez l'heure pour aller au passage.</p>
                  <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                    {groups.map((g, gi) => (
                      <div key={`${g[0].start}-${gi}`} className="flex items-center gap-2">
                        <button className="w-14 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground hover:text-primary" onClick={() => seek(g[0].start)}>
                          {formatTimecode(Math.max(0, g[0].start - start))}
                        </button>
                        <Input defaultValue={g.map((w) => w.text).join(" ")} onBlur={(e) => {
                          if (e.target.value !== g.map((w) => w.text).join(" ")) updateGroupText(gi, e.target.value);
                        }} className={cn("h-9 text-sm", activeGroup === g && "border-primary")} />
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {tab === "format" && (
              <>
                <div className="space-y-2">
                  <Label>Format</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {ASPECTS.map((a) => (
                      <Button key={a} variant={aspect === a ? "default" : "outline"} onClick={() => mark(setAspect)(a)}>{a}</Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">9:16 : TikTok, Reels, Shorts · 1:1 : feed · 16:9 : YouTube</p>
                </div>
                <div className="space-y-2">
                  <Label>Qualité</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {([720, 1080] as const).map((r) => (
                      <Button key={r} variant={resolution === r ? "default" : "outline"} disabled={r > ent.max_resolution} onClick={() => mark(setResolution)(r)}>
                        {r > ent.max_resolution && <Lock />} {r}p
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Cadrage</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <Button variant={crop.mode === "auto" ? "default" : "outline"} disabled={!hasFeature(ent, "smart_crop")} onClick={() => mark(setCrop)({ ...crop, mode: "auto" })}>
                      {!hasFeature(ent, "smart_crop") && <Lock />} Auto
                    </Button>
                    <Button variant={crop.mode === "center" ? "default" : "outline"} onClick={() => mark(setCrop)({ ...crop, mode: "center" })}>Centré</Button>
                    <Button variant={crop.mode === "manual" ? "default" : "outline"} onClick={() => mark(setCrop)({ ...crop, mode: "manual", x: crop.x ?? cx, zoom: crop.zoom ?? 1 })}>Manuel</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {crop.mode === "auto" ? "Suit automatiquement le visage de la personne qui parle." : crop.mode === "manual" ? "Glissez l'aperçu ou utilisez les curseurs." : "Cadre fixe au centre de l'image."}
                  </p>
                </div>
                {crop.mode === "manual" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Position horizontale</Label>
                      <Slider min={0} max={1} step={0.005} value={[crop.x ?? 0.5]} onValueChange={([v]) => mark(setCrop)({ ...crop, x: v })} thumbLabels={["Position"]} />
                    </div>
                    <div className="space-y-1">
                      <Label>Zoom (×{(crop.zoom ?? 1).toFixed(2)})</Label>
                      <Slider min={1} max={2} step={0.05} value={[crop.zoom ?? 1]} onValueChange={([v]) => mark(setCrop)({ ...crop, zoom: v })} thumbLabels={["Zoom"]} />
                    </div>
                  </div>
                )}
              </>
            )}

            {tab === "insights" && (
              <div className="space-y-4 text-sm">
                <div>
                  <Label>Pourquoi ce passage ?</Label>
                  <p className="mt-1 text-muted-foreground">{clip.reason || "—"}</p>
                </div>
                {clip.hookText && (
                  <div>
                    <Label>Accroche détectée</Label>
                    <p className="mt-1 rounded-lg border-l-2 border-primary bg-primary/5 px-3 py-2 italic">« {clip.hookText} »</p>
                  </div>
                )}
                {clip.viralityScore != null ? (
                  <div>
                    <Label>Détail du score <span className={scoreColor(clip.viralityScore)}>({clip.viralityScore}/100)</span></Label>
                    <div className="mt-2 space-y-2">
                      {Object.entries(clip.breakdown).map(([k, v]) => (
                        <div key={k} className="grid grid-cols-[90px_1fr_32px] items-center gap-2 text-xs">
                          <span className="text-muted-foreground">{BREAKDOWN_LABELS[k] ?? k}</span>
                          <Progress value={v} />
                          <span className="text-right tabular-nums">{v}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">Indicateur calculé à partir du texte et de l'audio. Il aide à prioriser, il ne prédit pas les vues.</p>
                  </div>
                ) : (
                  <p className="flex items-center gap-2 rounded-lg border bg-secondary/40 p-3 text-xs text-muted-foreground">
                    <Lock className="size-3.5" /> Hook Detector et Virality Score sont inclus dans l'offre Creator.
                  </p>
                )}
                <div>
                  <Label>Transcription</Label>
                  <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-muted-foreground">{clip.transcript}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="sticky bottom-20 z-10 flex flex-col gap-2 rounded-xl border bg-background/90 p-2 backdrop-blur sm:flex-row lg:bottom-4">
          <Button variant="outline" className="flex-1" loading={saving} onClick={() => save()} disabled={!dirty}>
            <Save /> Enregistrer
          </Button>
          <Button className="flex-1" onClick={exportClip} disabled={!!rendering || clip.video.expired || !lenOk}>
            {rendering ? <Loader2 className="animate-spin" /> : <Upload />} {clip.exportInfo ? "Réexporter" : "Exporter"}
          </Button>
          {clip.exportInfo && (
            <Button asChild variant="secondary" className="flex-1">
              <a href={`/api/clips/${clip.id}/download`}><Download /> Télécharger</a>
            </Button>
          )}
        </div>
        {clip.exportInfo && (
          <p className="text-center text-xs text-muted-foreground">
            Export actuel : {clip.exportInfo.width}×{clip.exportInfo.height} · {clip.exportInfo.duration.toFixed(1)} s · {formatBytes(clip.exportInfo.size)}
            {clip.exportInfo.watermark && " · avec filigrane"}
          </p>
        )}
        {preset && !canUsePreset(ent, preset) && (
          <p className="text-center text-xs text-warning">Le modèle actuel n'est plus inclus dans votre offre : choisissez-en un autre avant d'exporter.</p>
        )}
      </div>
    </div>
  );
}
