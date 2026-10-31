"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as tus from "tus-js-client";
import { toast } from "sonner";
import { AlertCircle, Check, FileVideo, Info, Lock, Sparkles, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label, NativeSelect, Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatBytes, formatDuration, formatMinutes } from "@/lib/format";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/public-env";
import { apiFetch } from "@/lib/api-client";
import { canProcessMinutes, clipsAvailable, hasFeature, type Entitlements } from "@/lib/entitlements";
import { ASPECTS, DEFAULT_SETTINGS, DURATION_RANGES, EDIT_STYLES, LANGUAGES, type GenerationSettings } from "@/lib/generation";
import { canUsePreset, SUBTITLE_PRESETS } from "@/lib/presets";
import { validateUpload } from "@/lib/upload";

type Phase = "pick" | "settings" | "uploading" | "starting";

function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const done = (d: number | null) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null);
    setTimeout(() => done(null), 15000);
    v.src = url;
  });
}

const STEPS = ["Vidéo", "Réglages", "Traitement"];

export function CreateWizard({
  entitlements: e,
  firstTime,
  projects,
  defaultProjectId,
  uploadsOpen,
}: {
  entitlements: Entitlements;
  firstTime: boolean;
  projects: { id: string; name: string }[];
  defaultProjectId?: string;
  uploadsOpen: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState<string>("");
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [settings, setSettings] = useState<GenerationSettings>(() => ({
    ...DEFAULT_SETTINGS,
    resolution: e.max_resolution >= 1080 ? 1080 : 720,
    clipCount: Math.max(1, Math.min(DEFAULT_SETTINGS.clipCount, clipsAvailable(e) ?? 20)),
    subtitlePreset: hasFeature(e, "custom_subtitles") ? "bold" : "classic",
    smartCrop: hasFeature(e, "smart_crop"),
  }));
  const uploadRef = useRef<tus.Upload | null>(null);
  const videoIdRef = useRef<string | null>(null);
  const rejectRef = useRef<((e: Error) => void) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = useRef<string | null>(null);

  useEffect(() => () => { if (preview.current) URL.revokeObjectURL(preview.current); }, []);

  const pick = useCallback(
    async (f: File | undefined) => {
      setError(null);
      if (!f) return;
      const d = await readDuration(f);
      const check = validateUpload({ filename: f.name, size: f.size, type: f.type, durationSeconds: d, maxUploadMb: e.max_upload_mb, maxVideoMinutes: e.max_video_minutes });
      if (!check.ok) return setError(check.error);
      if (d != null) {
        const q = canProcessMinutes(e, d / 60);
        if (!q.ok) return setError(q.reason);
      }
      if (preview.current) URL.revokeObjectURL(preview.current);
      preview.current = URL.createObjectURL(f);
      setFile(f);
      setDuration(d);
      setPhase("settings");
    },
    [e],
  );

  const clipsLeft = clipsAvailable(e);
  const maxClips = Math.min(20, clipsLeft ?? 20);
  const set = <K extends keyof GenerationSettings>(k: K, v: GenerationSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));

  async function start() {
    if (!file) return;
    setError(null);
    if (duration == null) return setError("Impossible de lire la durée de cette vidéo dans le navigateur. Essayez un autre fichier MP4.");
    setPhase("uploading");
    setProgress(0);
    try {
      const created = await apiFetch<{ videoId: string; projectId: string; bucket: string; path: string; mime: string }>("/api/videos", {
        method: "POST",
        json: { filename: file.name, size: file.size, type: file.type, durationSeconds: duration, projectId: projectId || undefined, settings },
      });
      videoIdRef.current = created.videoId;
      const { data } = await getBrowserSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Session expirée, reconnectez-vous.");

      const t0 = Date.now();
      await new Promise<void>((resolve, reject) => {
        rejectRef.current = reject;
        const upload = new tus.Upload(file, {
          endpoint: `${publicEnv.supabaseUrl}/storage/v1/upload/resumable`,
          retryDelays: [0, 2000, 5000, 10000, 20000],
          headers: { authorization: `Bearer ${token}`, "x-upsert": "false" },
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          chunkSize: 6 * 1024 * 1024, // required by Supabase resumable uploads
          metadata: { bucketName: created.bucket, objectName: created.path, contentType: created.mime, cacheControl: "3600" },
          onError: (err) => reject(new Error(String((err as Error).message ?? err).includes("row-level security")
            ? "Import refusé : l'emplacement réservé a expiré. Recommencez."
            : "L'envoi a échoué. Vérifiez votre connexion et réessayez.")),
          onProgress: (sent, total) => {
            setProgress((sent / total) * 100);
            const secs = (Date.now() - t0) / 1000;
            if (secs > 1) setSpeed(`${formatBytes(sent / secs)}/s`);
          },
          onSuccess: () => resolve(),
        });
        uploadRef.current = upload;
        upload.findPreviousUploads().then((prev) => {
          if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
          upload.start();
        });
      });

      setPhase("starting");
      await apiFetch(`/api/videos/${created.videoId}/complete`, { method: "POST" });
      toast.success("Vidéo envoyée ! L'analyse commence.");
      router.push(`/projects/${created.projectId}`);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg !== "cancelled") setError(msg);
      setPhase("settings");
    }
  }

  async function cancel() {
    await uploadRef.current?.abort(true).catch(() => undefined);
    uploadRef.current = null;
    rejectRef.current?.(new Error("cancelled"));
    if (videoIdRef.current) {
      await apiFetch(`/api/videos/${videoIdRef.current}`, { method: "DELETE" }).catch(() => undefined);
      videoIdRef.current = null;
    }
    setPhase("settings");
    setProgress(0);
    toast("Import annulé.");
  }

  const stepIndex = phase === "pick" ? 0 : phase === "settings" ? 1 : 2;
  const estimate = duration ? Math.ceil(duration / 6) / 10 : null;

  if (!uploadsOpen) {
    return (
      <Card><CardContent className="p-6 text-sm text-muted-foreground">Les imports sont temporairement suspendus pour maintenance. Réessayez un peu plus tard.</CardContent></Card>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <ol className="mb-6 flex items-center gap-2 text-sm" aria-label="Étapes">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span className={cn("grid size-7 place-items-center rounded-full border text-xs font-semibold",
              i < stepIndex && "border-primary bg-primary text-primary-foreground", i === stepIndex && "border-primary text-primary")}>
              {i < stepIndex ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn(i === stepIndex ? "font-medium" : "text-muted-foreground", "hidden sm:inline")}>{s}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border sm:w-10" />}
          </li>
        ))}
      </ol>

      {firstTime && phase === "pick" && (
        <div className="mb-4 flex gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <p className="font-medium">Votre premier projet — voici comment ça marche</p>
            <p className="mt-1 text-muted-foreground">
              1. Choisissez une vidéo où l'on parle (podcast, interview, vlog, cours). 2. Réglez la durée et le nombre de clips.
              3. ClipPilot transcrit, sélectionne les meilleurs passages, recadre et sous-titre. Vous serez prévenu quand c'est prêt.
            </p>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}

      {phase === "pick" && (
        <label
          onDragOver={(ev) => { ev.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(ev) => { ev.preventDefault(); setDragging(false); pick(ev.dataTransfer.files?.[0]); }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-card px-6 py-16 text-center transition-colors sm:py-24",
            dragging ? "border-primary bg-primary/5" : "hover:border-primary/50",
          )}
        >
          <span className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><UploadCloud className="size-7" /></span>
          <span className="mt-4 text-base font-medium">
            <span className="hidden sm:inline">Glissez votre vidéo ici ou </span>
            <span className="text-primary">choisissez un fichier</span>
          </span>
          <span className="mt-1 text-sm text-muted-foreground">
            MP4, MOV ou WEBM · {formatBytes(e.max_upload_mb * 1024 * 1024)} et {e.max_video_minutes} min maximum
          </span>
          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v"
            className="sr-only"
            onChange={(ev) => pick(ev.target.files?.[0])}
          />
          <span className="mt-6 text-xs text-muted-foreground">Importez uniquement des vidéos dont vous détenez les droits.</span>
        </label>
      )}

      {phase !== "pick" && file && (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <Card className="h-fit overflow-hidden">
            {preview.current && <video src={preview.current} className="aspect-video w-full bg-black object-contain" muted playsInline controls />}
            <CardContent className="space-y-1 p-4 text-sm">
              <p className="flex items-center gap-2 font-medium"><FileVideo className="size-4 shrink-0 text-primary" /><span className="truncate">{file.name}</span></p>
              <p className="text-muted-foreground">{formatDuration(duration)} · {formatBytes(file.size)}</p>
              {estimate != null && (
                <p className="text-muted-foreground">
                  Consommera <strong className="text-foreground">{formatMinutes(estimate)}</strong>
                  {e.unlimited ? " (illimité)" : ` sur ${formatMinutes(e.minutes_remaining)} restantes`}
                </p>
              )}
              {phase === "settings" && (
                <Button variant="ghost" size="sm" className="-ml-2 mt-1" onClick={() => { setFile(null); setPhase("pick"); }}>
                  Changer de vidéo
                </Button>
              )}
            </CardContent>
          </Card>

          {phase === "settings" ? (
            <Card>
              <CardContent className="space-y-6 p-5 sm:p-6">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Durée des clips" tip="ClipPilot coupe toujours sur des phrases complètes, la durée finale peut varier de quelques secondes.">
                    <NativeSelect value={settings.duration} onChange={(ev) => set("duration", ev.target.value as GenerationSettings["duration"])}>
                      {Object.entries(DURATION_RANGES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </NativeSelect>
                  </Field>
                  <Field label="Nombre de clips" tip={clipsLeft === null ? "Illimité" : `Il vous reste ${clipsLeft} clip(s) exportable(s) ce mois-ci.`}>
                    <div className="flex gap-2">
                      {[3, 5, 10].map((n) => (
                        <Button key={n} type="button" variant={settings.clipCount === n ? "default" : "outline"} disabled={n > maxClips} onClick={() => set("clipCount", n)} className="flex-1">
                          {n}
                        </Button>
                      ))}
                      <Input type="number" min={1} max={maxClips} value={settings.clipCount} aria-label="Nombre personnalisé"
                        onChange={(ev) => set("clipCount", Math.max(1, Math.min(maxClips, Number(ev.target.value) || 1)))} className="w-20" />
                    </div>
                  </Field>
                  <Field label="Format">
                    <div className="grid grid-cols-3 gap-2">
                      {ASPECTS.map((a) => (
                        <Button key={a} type="button" variant={settings.aspect === a ? "default" : "outline"} onClick={() => set("aspect", a)}>
                          <span className={cn("inline-block rounded-[3px] border-2 border-current", a === "9:16" ? "h-4 w-2.5" : a === "1:1" ? "size-3.5" : "h-2.5 w-4")} />
                          {a}
                        </Button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Qualité">
                    <div className="grid grid-cols-2 gap-2">
                      {([720, 1080] as const).map((r) => (
                        <Button key={r} type="button" variant={settings.resolution === r ? "default" : "outline"} disabled={r > e.max_resolution} onClick={() => set("resolution", r)}>
                          {r > e.max_resolution && <Lock />} {r}p
                        </Button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Langue">
                    <NativeSelect value={settings.language} onChange={(ev) => set("language", ev.target.value as GenerationSettings["language"])}>
                      {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </NativeSelect>
                  </Field>
                  <Field label="Style de montage" tip={EDIT_STYLES[settings.style].hint}>
                    <NativeSelect value={settings.style} onChange={(ev) => set("style", ev.target.value as GenerationSettings["style"])}>
                      {Object.entries(EDIT_STYLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </NativeSelect>
                  </Field>
                </div>

                <div>
                  <Label>Sous-titres</Label>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {SUBTITLE_PRESETS.map((p) => {
                      const ok = canUsePreset(e, p);
                      return (
                        <button key={p.id} type="button" disabled={!ok} onClick={() => set("subtitlePreset", p.id)}
                          className={cn("rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                            settings.subtitlePreset === p.id ? "border-primary bg-primary/10" : "hover:bg-secondary")}>
                          <span className="flex items-center justify-between text-sm font-medium">{p.name}{!ok && <Lock className="size-3.5" />}</span>
                          <span className="mt-1 block truncate text-xs" style={{ color: p.style.highlightColor === "#FFFFFF" ? undefined : p.style.highlightColor }}>
                            {p.style.uppercase ? "AA BB CC" : "Aa Bb Cc"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <label className="mt-3 flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                    Incruster les sous-titres
                    <Switch checked={settings.subtitlesEnabled} onCheckedChange={(v) => set("subtitlesEnabled", v)} />
                  </label>
                  <label className="mt-2 flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                    <span className="flex items-center gap-2">
                      Recadrage intelligent (suivi du visage)
                      {!hasFeature(e, "smart_crop") && <Lock className="size-3.5 text-muted-foreground" />}
                    </span>
                    <Switch checked={settings.smartCrop} disabled={!hasFeature(e, "smart_crop")} onCheckedChange={(v) => set("smartCrop", v)} />
                  </label>
                </div>

                {projects.length > 0 && (
                  <Field label="Projet">
                    <NativeSelect value={projectId} onChange={(ev) => setProjectId(ev.target.value)}>
                      <option value="">Nouveau projet (nom de la vidéo)</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </NativeSelect>
                  </Field>
                )}

                {e.watermark && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Sparkles className="size-3.5 text-primary" /> Offre Free : un petit filigrane ClipPilot est ajouté aux clips.
                  </p>
                )}
                <Button size="lg" className="w-full" onClick={start} disabled={maxClips < 1}>
                  {maxClips < 1 ? "Plus de clips disponibles ce mois-ci" : `Générer ${settings.clipCount} clip${settings.clipCount > 1 ? "s" : ""}`}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="space-y-4 p-6">
                <p className="font-medium">{phase === "uploading" ? "Envoi de la vidéo…" : "Lancement de l'analyse…"}</p>
                <Progress value={phase === "uploading" ? progress : 100} label="Progression de l'envoi" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{Math.round(progress)} %</span>
                  <span>{speed}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Gardez cette page ouverte pendant l'envoi. En cas de coupure, l'envoi reprendra là où il s'est arrêté si vous relancez le même fichier.
                </p>
                {phase === "uploading" && (
                  <Button variant="outline" onClick={cancel}><X /> Annuler l'import</Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, tip, children }: { label: string; tip?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Label>{label}</Label>
        {tip && (
          <Tip content={tip}>
            <button type="button" aria-label={`Aide : ${label}`} className="text-muted-foreground hover:text-foreground"><Info className="size-3.5" /></button>
          </Tip>
        )}
      </div>
      {children}
    </div>
  );
}
