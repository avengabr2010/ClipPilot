"""ClipPilot worker entrypoint.

    python -m clippilot_worker.main            # run forever
    python -m clippilot_worker.main --once     # process at most one job (cron / tests)
    python -m clippilot_worker.main --cleanup  # run the cleanup routine once

Scale horizontally by running more worker processes/containers: jobs are
claimed atomically with `FOR UPDATE SKIP LOCKED`, so workers never collide.
"""
from __future__ import annotations

import argparse
import logging
import signal
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from . import media, pipeline
from .config import Config
from .supabase_client import Supabase, SupabaseError

log = logging.getLogger("clippilot.worker")
_shutdown = threading.Event()


def handle_job(db: Supabase, cfg: Config, job: dict) -> None:
    jid = job["id"]
    log.info("job %s (%s) attempt %s started", jid, job["type"], job["attempts"])
    t0 = time.monotonic()
    with pipeline.JobContext(db, job, cfg.worker_id, cfg.job_timeout_seconds) as ctx:
        try:
            if job["type"] == "process_video":
                result = pipeline.process_video(db, cfg, job, ctx)
            elif job["type"] == "render_clip":
                result = pipeline.render_existing_clip(db, cfg, job, ctx)
            elif job["type"] == "cleanup":
                result = pipeline.cleanup(db, cfg)
            else:
                raise pipeline.UserFacingError(f"unknown job type {job['type']}")
            db.rpc("complete_job", {"p_job": jid, "p_worker": cfg.worker_id, "p_result": result})
            log.info("job %s succeeded in %.1fs: %s", jid, time.monotonic() - t0, result)
        except media.Cancelled:
            log.info("job %s cancelled", jid)
            # status was already set to cancelled by the API (or timeout): record it if needed
            db.rpc("fail_job", {"p_job": jid, "p_worker": cfg.worker_id, "p_error": "Annulé ou délai dépassé.", "p_retryable": False})
            _mark_failed(db, job, "Traitement annulé ou délai dépassé.", refund=True)
        except pipeline.UserFacingError as e:
            log.info("job %s rejected: %s", jid, e)
            db.rpc("fail_job", {"p_job": jid, "p_worker": cfg.worker_id, "p_error": str(e), "p_retryable": False})
            _mark_failed(db, job, str(e), refund=False)  # refund already handled in the pipeline
        except Exception as e:  # noqa: BLE001
            log.exception("job %s crashed", jid)
            retry = not isinstance(e, SupabaseError) or e.transient
            status = db.rpc("fail_job", {"p_job": jid, "p_worker": cfg.worker_id, "p_error": str(e)[:2000], "p_retryable": True if retry else False})
            if status == "failed":
                _mark_failed(db, job, "Le traitement a échoué. Vos minutes ont été recréditées, réessayez dans quelques minutes.", refund=True)


def _mark_failed(db: Supabase, job: dict, message: str, refund: bool) -> None:
    try:
        if job["type"] == "process_video" and job.get("video_id"):
            if refund:
                db.rpc("refund_minutes", {"p_user": job["user_id"], "p_video": job["video_id"], "p_note": "job failed"})
            db.update("videos", f"id=eq.{job['video_id']}&status=neq.ready", {"status": "failed", "error": message[:500]})
            db.update("clips", f"video_id=eq.{job['video_id']}&status=in.(pending,rendering)", {"status": "failed", "error": message[:300]})
        elif job["type"] == "render_clip" and job.get("clip_id"):
            has_export = db.select("exports", f"clip_id=eq.{job['clip_id']}&select=id&limit=1")
            db.update("clips", f"id=eq.{job['clip_id']}", {"status": "ready" if has_export else "failed", "error": message[:300]})
    except SupabaseError:
        log.exception("could not record failure for job %s", job["id"])


def claim(db: Supabase, cfg: Config) -> dict | None:
    rows = db.rpc("claim_next_job", {"p_worker": cfg.worker_id, "p_types": cfg.job_types})
    return rows[0] if rows else None


def run(cfg: Config, once: bool = False) -> None:
    media.ensure_binaries()
    cfg.tmp_dir.mkdir(parents=True, exist_ok=True)
    db = Supabase(cfg.supabase_url, cfg.service_role_key)
    log.info("worker %s started (concurrency=%s, types=%s, whisper=%s)", cfg.worker_id, cfg.concurrency, cfg.job_types, cfg.whisper_model)
    last_cleanup = 0.0
    with ThreadPoolExecutor(max_workers=cfg.concurrency) as pool:
        running: set = set()
        while not _shutdown.is_set():
            running = {f for f in running if not f.done()}
            if time.monotonic() - last_cleanup > 600:
                try:
                    log.info("cleanup: %s", pipeline.cleanup(db, cfg))
                except Exception:  # noqa: BLE001
                    log.exception("cleanup failed")
                last_cleanup = time.monotonic()
            if len(running) < cfg.concurrency:
                try:
                    job = claim(db, cfg)
                except SupabaseError as e:
                    log.warning("claim failed: %s", e)
                    job = None
                if job:
                    running.add(pool.submit(handle_job, db, cfg, job))
                    if once:
                        break
                    continue
                if once:
                    break
            _shutdown.wait(cfg.poll_interval)
        for f in running:
            f.result()
    log.info("worker stopped")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--cleanup", action="store_true")
    args = parser.parse_args()
    cfg = Config.from_env()
    signal.signal(signal.SIGTERM, lambda *_: _shutdown.set())
    signal.signal(signal.SIGINT, lambda *_: _shutdown.set())
    if args.cleanup:
        print(pipeline.cleanup(Supabase(cfg.supabase_url, cfg.service_role_key), cfg))
        return
    run(cfg, once=args.once)


if __name__ == "__main__":
    main()
