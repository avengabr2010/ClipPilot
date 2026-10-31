"""Worker configuration, read from environment variables."""
from __future__ import annotations

import os
import socket
from dataclasses import dataclass, field
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    return int(raw) if raw else default


@dataclass(frozen=True)
class Config:
    supabase_url: str
    service_role_key: str
    worker_id: str
    concurrency: int
    poll_interval: float
    job_timeout_seconds: int
    tmp_dir: Path
    whisper_model: str
    whisper_device: str
    whisper_compute_type: str
    whisper_model_dir: str | None
    anthropic_api_key: str | None
    anthropic_model: str
    source_retention_days: int
    export_retention_days: int
    fonts_dir: Path
    ffmpeg_threads: int
    job_types: list[str] = field(default_factory=lambda: ["process_video", "render_clip"])

    @staticmethod
    def from_env() -> "Config":
        url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or ""
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if not url or not key:
            raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (see .env.example).")
        types = [t.strip() for t in os.environ.get("WORKER_JOB_TYPES", "process_video,render_clip").split(",") if t.strip()]
        return Config(
            supabase_url=url.rstrip("/"),
            service_role_key=key,
            worker_id=os.environ.get("WORKER_ID") or f"{socket.gethostname()}-{os.getpid()}",
            concurrency=max(1, _int("WORKER_CONCURRENCY", 1)),
            poll_interval=float(os.environ.get("WORKER_POLL_INTERVAL", "3")),
            job_timeout_seconds=_int("JOB_TIMEOUT_SECONDS", 3 * 3600),
            tmp_dir=Path(os.environ.get("WORKER_TMP_DIR", "/tmp/clippilot")),
            whisper_model=os.environ.get("WHISPER_MODEL", "small"),
            whisper_device=os.environ.get("WHISPER_DEVICE", "auto"),
            whisper_compute_type=os.environ.get("WHISPER_COMPUTE_TYPE", "int8"),
            whisper_model_dir=os.environ.get("WHISPER_MODEL_DIR") or None,
            anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY") or None,
            anthropic_model=os.environ.get("ANTHROPIC_MODEL", "claude-haiku-5-5"),
            source_retention_days=_int("SOURCE_RETENTION_DAYS", 7),
            export_retention_days=_int("EXPORT_RETENTION_DAYS", 30),
            fonts_dir=Path(os.environ.get("FONTS_DIR", str(PACKAGE_DIR.parent / "fonts"))),
            ffmpeg_threads=_int("FFMPEG_THREADS", 0),
            job_types=types,
        )
