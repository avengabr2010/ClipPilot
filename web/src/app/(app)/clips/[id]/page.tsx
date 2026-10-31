import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { ClipEditor, type EditorClip } from "@/components/app/clip-editor";
import { uuidRe } from "@/lib/api";
import { getPreset } from "@/lib/presets";
import type { JobRow } from "@/components/app/job-progress";

export const metadata: Metadata = { title: "Éditeur de clip" };

interface Word { start: number; end: number; text: string }

export default async function ClipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidRe.test(id)) notFound();
  const { user, entitlements } = await requireSession();
  const sb = await getServerSupabase();
  const { data: clip } = await sb
    .from("clips")
    .select("id, title, start_seconds, end_seconds, transcript, reason, hook_type, hook_text, virality_score, score_breakdown, status, error, video_id, project_id, projects(name), videos(duration_seconds, width, height, status)")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!clip) notFound();

  const [{ data: edit }, { data: transcript }, { data: exp }, { data: jobs }] = await Promise.all([
    sb.from("clip_edits").select("*").eq("clip_id", id).maybeSingle(),
    sb.from("transcripts").select("words").eq("video_id", clip.video_id).maybeSingle(),
    sb.from("exports").select("id, width, height, size_bytes, duration_seconds, created_at, watermark").eq("clip_id", id).eq("is_current", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("video_jobs").select("id, type, status, progress, stage, error, video_id, clip_id, created_at").eq("clip_id", id).order("created_at", { ascending: false }).limit(1),
  ]);

  const video = clip.videos as unknown as { duration_seconds: number; width: number; height: number; status: string };
  const s = Number(clip.start_seconds);
  const e = Number(clip.end_seconds);
  const lo = Math.max(0, s - 60);
  const hi = e + 60;
  const allWords = ((transcript?.words ?? []) as Word[]).filter((w) => w.end >= lo && w.start <= hi).map((w) => ({ start: w.start, end: w.end, text: w.text }));
  const editedWords = (edit?.subtitle_words as Word[] | null) ?? null;
  const template = edit?.template ?? "classic";

  const data: EditorClip = {
    id: clip.id,
    title: clip.title,
    projectId: clip.project_id,
    projectName: (clip.projects as unknown as { name: string } | null)?.name ?? "",
    originalStart: s,
    originalEnd: e,
    transcript: clip.transcript,
    reason: clip.reason,
    hookType: clip.hook_type,
    hookText: clip.hook_text,
    viralityScore: clip.virality_score,
    breakdown: (clip.score_breakdown ?? {}) as Record<string, number>,
    status: clip.status,
    error: clip.error,
    video: { duration: Number(video?.duration_seconds ?? e), width: video?.width ?? 1920, height: video?.height ?? 1080, expired: video?.status === "expired" },
    edit: {
      start: Number(edit?.start_seconds ?? s),
      end: Number(edit?.end_seconds ?? e),
      aspect: (edit?.aspect_ratio ?? "9:16") as EditorClip["edit"]["aspect"],
      resolution: (edit?.resolution ?? 720) as 720 | 1080,
      template,
      style: { ...(getPreset(template)?.style ?? getPreset("classic")!.style), ...((edit?.subtitle_style as object) ?? {}) },
      subtitlesEnabled: edit?.subtitles_enabled ?? true,
      crop: (edit?.crop as EditorClip["edit"]["crop"]) ?? { mode: "auto" },
    },
    words: editedWords && editedWords.length ? mergeWords(allWords, editedWords) : allWords,
    exportInfo: exp ? { width: exp.width, height: exp.height, size: exp.size_bytes, duration: Number(exp.duration_seconds), createdAt: exp.created_at, watermark: exp.watermark } : null,
  };

  return (
    <>
      <Link href={`/projects/${clip.project_id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> {data.projectName || "Projet"}
      </Link>
      <ClipEditor clip={data} entitlements={entitlements} lastJob={(jobs?.[0] as JobRow) ?? null} />
    </>
  );
}

/** Edited words replace the original ones inside their own time span. */
function mergeWords(all: Word[], edited: Word[]): Word[] {
  const a = edited[0].start;
  const b = edited[edited.length - 1].end;
  return [...all.filter((w) => w.end <= a), ...edited, ...all.filter((w) => w.start >= b)].sort((x, y) => x.start - y.start);
}
