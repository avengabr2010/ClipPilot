"""Job handlers: process_video (full pipeline), render_clip (re-export), cleanup."""
from __future__ import annotations

import logging
import math
import shutil
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from . import analysis, llm, media, reframe
from .config import Config
from .render import RenderSpec, render_clip
from .subtitles import resolve_style, words_for_clip
from .supabase_client import Supabase, SupabaseError
from .transcribe import Transcript, transcribe

log = logging.getLogger(__name__)

DURATION_RANGES = {"15-30": (15, 30), "30-45": (30, 45), "45-60": (45, 60), "60-90": (60, 90)}


class UserFacingError(RuntimeError):
    """Failure caused by the input or quota: not retried, message shown to the user."""


def now_iso(delta_days: float = 0) -> str:
    # "Z" suffix (not "+00:00"): a raw "+" would be decoded as a space in PostgREST query strings.
    return (datetime.now(timezone.utc) + timedelta(days=delta_days)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


class JobContext:
    """Heartbeat + progress + cancellation for one running job."""

    def __init__(self, db: Supabase, job: dict, worker_id: str, timeout: int):
        self.db, self.job, self.worker_id = db, job, worker_id
        self.cancel = threading.Event()
        self.progress, self.stage = 0, "starting"
        self.deadline = time.monotonic() + timeout
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._beat, daemon=True)

    def __enter__(self) -> "JobContext":
        self._thread.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self._stop.set()
        self._thread.join(timeout=5)

    def _beat(self) -> None:
        while not self._stop.wait(10):
            self._send()
            if time.monotonic() > self.deadline:
                log.warning("job %s exceeded timeout", self.job["id"])
                self.cancel.set()

    def _send(self) -> None:
        try:
            alive = self.db.rpc("job_heartbeat", {"p_job": self.job["id"], "p_worker": self.worker_id,
                                                  "p_progress": self.progress, "p_stage": self.stage})
            if alive is False:  # cancelled by the user/admin, or lock lost
                self.cancel.set()
        except SupabaseError as e:
            log.warning("heartbeat failed: %s", e)

    def update(self, progress: float, stage: str | None = None) -> None:
        self.progress = int(max(self.progress, min(99, progress)))
        if stage:
            self.stage = stage
        self._send()
        self.check()

    def check(self) -> None:
        if self.cancel.is_set():
            raise media.Cancelled("cancelled")


# ---------------------------------------------------------------------------
def _entitlements(db: Supabase, user_id: str) -> dict:
    return db.rpc("get_entitlements", {"p_user": user_id})


def _flag(db: Supabase, key: str, default: bool) -> bool:
    row = db.select_one("feature_flags", f"key=eq.{key}&select=enabled")
    return bool(row["enabled"]) if row else default


def _download_source(db: Supabase, video: dict, work: Path) -> Path:
    ext = Path(video["storage_path"]).suffix or ".mp4"
    dest = work / f"source{ext}"
    if not dest.exists():
        db.download("sources", video["storage_path"], dest)
    return dest


def _export_clip(db: Supabase, cfg: Config, ctx: JobContext, *, clip: dict, src: Path, probe: media.ProbeResult,
                 spec: RenderSpec, work: Path) -> dict:
    """Render -> validate -> upload -> charge -> record. Returns the export row."""
    out = work / f"{clip['id']}.mp4"
    result = render_clip(src, probe, spec, out, work, cfg.fonts_dir, threads=cfg.ffmpeg_threads, cancel=ctx.cancel)
    thumb = media.thumbnail(out, work / f"{clip['id']}.jpg", at=min(1.0, result.duration / 3))
    export_id = str(uuid.uuid4())
    user = clip["user_id"]
    path = f"{user}/{clip['id']}/{export_id}.mp4"
    db.upload("exports", path, out, "video/mp4")
    db.upload("exports", f"{user}/{clip['id']}/thumb.jpg", thumb, "image/jpeg")
    try:
        db.rpc("consume_clip", {"p_user": user, "p_clip": clip["id"]})
    except SupabaseError as e:
        db.remove("exports", [path])
        if "insufficient_clips" in e.message:
            raise UserFacingError("Quota de clips exportables atteint pour ce mois-ci.") from e
        raise
    previous = db.select("exports", f"clip_id=eq.{clip['id']}&is_current=eq.true&select=id,storage_path")
    row = db.insert("exports", {
        "id": export_id, "clip_id": clip["id"], "user_id": user, "storage_path": path,
        "aspect_ratio": spec.aspect, "resolution": spec.resolution, "width": result.width, "height": result.height,
        "size_bytes": out.stat().st_size, "duration_seconds": round(result.duration, 3), "watermark": spec.watermark,
        "is_current": True, "expires_at": now_iso(cfg.export_retention_days),
    })[0]
    if previous:
        db.remove("exports", [p["storage_path"] for p in previous])
        db.delete("exports", "id=in.(" + ",".join(p["id"] for p in previous) + ")")
    db.update("clips", f"id=eq.{clip['id']}", {"status": "ready", "error": None})
    out.unlink(missing_ok=True)
    return row


def _keyframes(cfg: Config, src: Path, start: float, end: float, aspect: str, probe: media.ProbeResult,
               speaker: bool) -> list[reframe.Keyframe] | None:
    src_w, src_h = probe.display_size
    cw, _ = reframe.crop_geometry(src_w, src_h, aspect)
    if cw >= src_w:
        return None
    samples = reframe.track_faces(src, start, end, speaker_tracking=speaker)
    if not samples or all(x is None for _, x in samples):
        return None
    return reframe.smooth_path(samples, cw / src_w)


# ---------------------------------------------------------------------------
def process_video(db: Supabase, cfg: Config, job: dict, ctx: JobContext) -> dict:
    video = db.select_one("videos", f"id=eq.{job['video_id']}&select=*")
    if not video:
        raise UserFacingError("Vidéo introuvable.")
    user = video["user_id"]
    settings = video.get("settings") or {}
    work = cfg.tmp_dir / job["id"]
    work.mkdir(parents=True, exist_ok=True)
    charged = False
    try:
        ctx.update(2, "downloading")
        src = _download_source(db, video, work)
        ctx.update(6, "probing")
        try:
            probe = media.probe(src)
        except media.MediaError as e:
            db.remove("sources", [video["storage_path"]])
            raise UserFacingError(str(e)) from e
        ent = _entitlements(db, user)
        if not ent["unlimited"] and probe.duration > ent["max_video_minutes"] * 60 + 1:
            db.remove("sources", [video["storage_path"]])
            raise UserFacingError(f"Vidéo trop longue : {ent['max_video_minutes']} minutes maximum avec votre offre.")
        if probe.duration < 10:
            raise UserFacingError("La vidéo doit durer au moins 10 secondes.")
        if not probe.has_audio:
            raise UserFacingError("La vidéo ne contient pas de piste audio : impossible de détecter les meilleurs moments.")

        minutes = math.ceil(probe.duration / 6) / 10  # rounded up to 0.1 min
        try:
            db.rpc("consume_minutes", {"p_user": user, "p_minutes": minutes, "p_video": video["id"]})
            charged = True
        except SupabaseError as e:
            if "insufficient_minutes" in e.message:
                raise UserFacingError("Quota de minutes insuffisant pour cette vidéo ce mois-ci.") from e
            raise
        w, h = probe.display_size
        db.update("videos", f"id=eq.{video['id']}", {"status": "processing", "duration_seconds": round(probe.duration, 2),
                                                      "width": w, "height": h, "error": None})

        # 1. Transcription -------------------------------------------------
        ctx.update(10, "extracting_audio")
        wav = media.extract_audio(src, work / "audio.wav", cancel=ctx.cancel)
        levels = media.audio_levels(wav)
        existing = db.select_one("transcripts", f"video_id=eq.{video['id']}&select=language,words,segments,model")
        if existing and existing["words"]:
            tr = Transcript.from_json(existing["language"], existing["words"], existing["segments"], existing["model"])
        else:
            ctx.update(14, "transcribing")
            tr = transcribe(
                wav, language=settings.get("language"), model_name=cfg.whisper_model, device=cfg.whisper_device,
                compute_type=cfg.whisper_compute_type, download_root=cfg.whisper_model_dir, duration=probe.duration,
                on_progress=lambda f: ctx.update(14 + 46 * f), cancel=ctx.cancel,
            )
            db.insert("transcripts", {
                "video_id": video["id"], "user_id": user, "language": tr.language, "model": tr.model,
                "full_text": tr.full_text, "segments": tr.segments_json(), "words": tr.words_json(),
            }, upsert=True)
        if len(tr.words) < 15:
            raise UserFacingError("Trop peu de parole détectée dans la vidéo pour créer des clips.")

        # 2-3. Analysis & selection ---------------------------------------------
        ctx.update(62, "analyzing")
        rng = DURATION_RANGES.get(settings.get("duration", "30-45"), (30, 45))
        ent = _entitlements(db, user)
        # On a retry, clips already exported are kept (and already paid for).
        db.delete("clips", f"video_id=eq.{video['id']}&status=neq.ready")
        kept = db.select("clips", f"video_id=eq.{video['id']}&select=start_seconds,end_seconds")
        requested = max(0, int(settings.get("clipCount", 5)) - len(kept))
        allowed = requested if ent["unlimited"] else min(requested, int(ent["clips_remaining"] or 0))
        if allowed < 1 and kept:
            db.update("videos", f"id=eq.{video['id']}", {"status": "ready", "expires_at": now_iso(cfg.source_retention_days)})
            return {"clips": len(kept), "failed": 0, "language": tr.language, "minutes": minutes}
        if allowed < 1:
            raise UserFacingError("Vous avez utilisé tous vos clips exportables ce mois-ci.")
        cands = analysis.select_clips(tr.words, duration_range=rng, count=allowed + 3 + len(kept),
                                      style=settings.get("style", "dynamic"), levels=levels, video_duration=probe.duration)
        cands = [c for c in cands if not any(
            min(c.end, float(k["end_seconds"])) - max(c.start, float(k["start_seconds"])) > 0 for k in kept)]
        if cfg.anthropic_api_key and _flag(db, "llm_analysis", True):
            ctx.update(66, "refining")
            cands = llm.refine(cands, cfg.anthropic_api_key, cfg.anthropic_model)
        cands = cands[:allowed]
        if not cands:
            raise UserFacingError("Aucun passage exploitable n'a été trouvé. Essayez une autre durée de clip.")

        show_hooks = bool(settings.get("hookDetector")) or ent["unlimited"]
        show_score = bool(settings.get("viralityScore")) or ent["unlimited"]
        clip_rows = db.insert("clips", [{
            "user_id": user, "video_id": video["id"], "project_id": video["project_id"],
            "title": c.title, "start_seconds": round(c.start, 3), "end_seconds": round(c.end, 3),
            "transcript": c.text, "reason": analysis.explain(c),
            "hook_type": c.hook_type if show_hooks else None, "hook_text": c.hook_text if show_hooks else None,
            "virality_score": analysis.virality_from_score(c.score) if show_score else None,
            "score_breakdown": c.breakdown if show_score else {}, "rank": len(kept) + i + 1, "status": "pending",
        } for i, c in enumerate(cands)])

        # 4-5. Reframe, render, export -------------------------------------------
        aspect = settings.get("aspect", "9:16")
        resolution = min(int(settings.get("resolution", 720)), int(ent["max_resolution"]))
        template = settings.get("subtitlePreset", "classic")
        style = resolve_style(template, None)
        smart = bool(settings.get("smartCrop", True))
        speaker = _flag(db, "speaker_tracking", True)
        done, failures = 0, []
        for i, clip in enumerate(clip_rows):
            ctx.update(70 + 28 * i / len(clip_rows), f"rendering_{i + 1}_of_{len(clip_rows)}")
            start, end = float(clip["start_seconds"]), float(clip["end_seconds"])
            kf = _keyframes(cfg, src, start, end, aspect, probe, speaker) if smart else None
            crop = {"mode": "auto" if smart else "center",
                    "keyframes": [{"t": round(k.t, 2), "x": round(k.x, 4)} for k in kf] if kf else None}
            db.insert("clip_edits", {
                "clip_id": clip["id"], "user_id": user, "start_seconds": start, "end_seconds": end,
                "aspect_ratio": aspect, "resolution": resolution, "template": template, "subtitle_style": style,
                "subtitles_enabled": bool(settings.get("subtitlesEnabled", True)), "crop": crop,
            }, upsert=True)
            spec = RenderSpec(start=start, end=end, aspect=aspect, resolution=resolution, style=style,
                              words=words_for_clip(tr.words_json(), start, end),
                              subtitles=bool(settings.get("subtitlesEnabled", True)), watermark=bool(ent["watermark"]),
                              crop_mode=crop["mode"], keyframes=kf)
            db.update("clips", f"id=eq.{clip['id']}", {"status": "rendering"})
            try:
                _export_clip(db, cfg, ctx, clip=clip, src=src, probe=probe, spec=spec, work=work)
                done += 1
            except (media.Cancelled, UserFacingError):
                raise
            except Exception as e:  # one bad clip must not sink the others
                log.exception("clip %s failed", clip["id"])
                failures.append(str(e)[:300])
                db.update("clips", f"id=eq.{clip['id']}", {"status": "failed", "error": "Le rendu de ce clip a échoué."})
        if done == 0:
            raise RuntimeError("all clip renders failed: " + "; ".join(failures))

        db.update("videos", f"id=eq.{video['id']}", {"status": "ready", "expires_at": now_iso(cfg.source_retention_days)})
        db.insert("usage_logs", {"user_id": user, "event": "video.processed", "quantity": probe.duration,
                                 "metadata": {"video_id": video["id"], "clips": done}})
        return {"clips": done, "failed": len(failures), "language": tr.language, "minutes": minutes}
    except UserFacingError:
        if charged:
            db.rpc("refund_minutes", {"p_user": user, "p_video": video["id"], "p_note": "processing failed"})
        raise
    finally:
        shutil.rmtree(work, ignore_errors=True)


def merge_words(transcript: list[dict], edited: list[dict]) -> list[dict]:
    if not edited:
        return transcript
    a, b = float(edited[0]["start"]), float(edited[-1]["end"])
    keep = [w for w in transcript if float(w["end"]) <= a or float(w["start"]) >= b]
    return sorted(keep + edited, key=lambda w: float(w["start"]))


def render_existing_clip(db: Supabase, cfg: Config, job: dict, ctx: JobContext) -> dict:
    clip = db.select_one("clips", f"id=eq.{job['clip_id']}&select=*")
    if not clip:
        raise UserFacingError("Clip introuvable.")
    video = db.select_one("videos", f"id=eq.{clip['video_id']}&select=*")
    if not video or video["status"] == "expired":
        raise UserFacingError("La vidéo source a expiré.")
    edit = db.select_one("clip_edits", f"clip_id=eq.{clip['id']}&select=*") or {}
    tr = db.select_one("transcripts", f"video_id=eq.{video['id']}&select=words")
    ent = _entitlements(db, clip["user_id"])
    work = cfg.tmp_dir / job["id"]
    work.mkdir(parents=True, exist_ok=True)
    try:
        ctx.update(5, "downloading")
        src = _download_source(db, video, work)
        probe = media.probe(src)
        start = float(edit.get("start_seconds") or clip["start_seconds"])
        end = min(float(edit.get("end_seconds") or clip["end_seconds"]), probe.duration)
        aspect = edit.get("aspect_ratio") or "9:16"
        resolution = min(int(edit.get("resolution") or 720), int(ent["max_resolution"]))
        crop = edit.get("crop") or {"mode": "auto"}
        mode = crop.get("mode", "auto")
        kf = None
        if mode == "auto":
            ctx.update(20, "reframing")
            kf = _keyframes(cfg, src, start, end, aspect, probe, _flag(db, "speaker_tracking", True))
        # Edited words are stored with absolute timestamps (same as the transcript) and
        # replace the transcript inside the span they cover.
        words_src = merge_words((tr or {}).get("words") or [], edit.get("subtitle_words") or [])
        style = resolve_style(edit.get("template") or "classic", edit.get("subtitle_style") or None)
        spec = RenderSpec(start=start, end=end, aspect=aspect, resolution=resolution, style=style,
                          words=words_for_clip(words_src, start, end), subtitles=bool(edit.get("subtitles_enabled", True)),
                          watermark=bool(ent["watermark"]), crop_mode=mode, crop_x=float(crop.get("x", 0.5)),
                          zoom=float(crop.get("zoom", 1.0)), keyframes=kf)
        ctx.update(40, "rendering")
        row = _export_clip(db, cfg, ctx, clip=clip, src=src, probe=probe, spec=spec, work=work)
        return {"export_id": row["id"]}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def cleanup(db: Supabase, cfg: Config) -> dict:
    """Deletes expired sources/exports and abandoned uploads. Safe to run often."""
    now = now_iso()
    removed_sources = removed_exports = abandoned = 0
    for v in db.select("videos", f"expires_at=lt.{now}&status=neq.expired&select=id,storage_path&limit=200"):
        db.remove("sources", [v["storage_path"]])
        db.update("videos", f"id=eq.{v['id']}", {"status": "expired"})
        removed_sources += 1
    for e in db.select("exports", f"expires_at=lt.{now}&select=id,storage_path,clip_id&limit=500"):
        db.remove("exports", [e["storage_path"]])
        db.delete("exports", f"id=eq.{e['id']}")
        removed_exports += 1
    stale = now_iso(-1)
    for v in db.select("videos", f"status=eq.uploading&created_at=lt.{stale}&select=id,storage_path&limit=200"):
        db.remove("sources", [v["storage_path"]])
        db.delete("videos", f"id=eq.{v['id']}")
        abandoned += 1
    requeued = db.rpc("requeue_stale_jobs", {"p_stale_seconds": 300})
    shutil.rmtree(cfg.tmp_dir / "orphans", ignore_errors=True)
    return {"sources": removed_sources, "exports": removed_exports, "abandoned_uploads": abandoned, "requeued": requeued}
