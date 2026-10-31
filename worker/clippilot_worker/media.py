"""FFmpeg / FFprobe helpers.

Every external process runs with a timeout and can be cancelled through a
`threading.Event`, so a cancelled or timed-out job never leaves an ffmpeg
process running.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import threading
import time
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np

ALLOWED_FORMATS = {"mov", "mp4", "m4a", "3gp", "3g2", "mj2", "matroska", "webm"}
ALLOWED_VIDEO_CODECS = {"h264", "hevc", "vp8", "vp9", "av1", "mpeg4", "prores", "mjpeg"}


class MediaError(RuntimeError):
    """A problem with the user's file (not retryable)."""


class Cancelled(RuntimeError):
    pass


def ensure_binaries() -> None:
    for b in ("ffmpeg", "ffprobe"):
        if not shutil.which(b):
            raise SystemExit(f"{b} not found in PATH — install FFmpeg (see INSTALLATION.md).")


def run(cmd: list[str], *, timeout: float, cancel: threading.Event | None = None) -> subprocess.CompletedProcess:
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    deadline = time.monotonic() + timeout
    while True:
        try:
            out, err = proc.communicate(timeout=0.5)
            break
        except subprocess.TimeoutExpired:
            if cancel is not None and cancel.is_set():
                proc.kill()
                proc.communicate()
                raise Cancelled("cancelled")
            if time.monotonic() > deadline:
                proc.kill()
                proc.communicate()
                raise TimeoutError(f"{cmd[0]} timed out after {timeout:.0f}s")
    result = subprocess.CompletedProcess(cmd, proc.returncode, out, err)
    if proc.returncode != 0:
        tail = err.decode(errors="replace")[-1500:]
        raise RuntimeError(f"{cmd[0]} failed ({proc.returncode}): {tail}")
    return result


@dataclass
class ProbeResult:
    duration: float
    width: int
    height: int
    fps: float
    rotation: int
    has_audio: bool
    format_name: str
    video_codec: str

    @property
    def display_size(self) -> tuple[int, int]:
        """Width/height after applying rotation metadata (phones record rotated)."""
        if self.rotation in (90, 270):
            return self.height, self.width
        return self.width, self.height


def probe(path: Path) -> ProbeResult:
    try:
        r = run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
            timeout=120,
        )
    except RuntimeError as e:
        raise MediaError("Le fichier n'est pas une vidéo lisible.") from e
    info = json.loads(r.stdout or b"{}")
    fmt = info.get("format", {})
    formats = set(str(fmt.get("format_name", "")).split(","))
    if not formats & ALLOWED_FORMATS:
        raise MediaError("Format de conteneur non pris en charge (MP4, MOV ou WEBM attendu).")
    video = next((s for s in info.get("streams", []) if s.get("codec_type") == "video" and s.get("disposition", {}).get("attached_pic") != 1), None)
    if not video:
        raise MediaError("Aucune piste vidéo trouvée dans le fichier.")
    codec = str(video.get("codec_name", ""))
    if codec not in ALLOWED_VIDEO_CODECS:
        raise MediaError(f"Codec vidéo non pris en charge : {codec or 'inconnu'}.")
    has_audio = any(s.get("codec_type") == "audio" for s in info.get("streams", []))
    try:
        duration = float(fmt.get("duration") or video.get("duration") or 0)
    except ValueError:
        duration = 0.0
    rotation = 0
    for sd in video.get("side_data_list", []) or []:
        if "rotation" in sd:
            rotation = int(abs(int(sd["rotation"]))) % 360
    if "rotate" in (video.get("tags") or {}):
        rotation = int(abs(int(video["tags"]["rotate"]))) % 360
    num, _, den = str(video.get("avg_frame_rate", "30/1")).partition("/")
    try:
        fps = float(num) / float(den or 1)
    except (ValueError, ZeroDivisionError):
        fps = 30.0
    w, h = int(video.get("width") or 0), int(video.get("height") or 0)
    if duration <= 0 or w <= 0 or h <= 0:
        raise MediaError("Impossible de lire la durée ou les dimensions de la vidéo.")
    if w * h > 4096 * 4096:
        raise MediaError("Résolution trop élevée (4K maximum).")
    return ProbeResult(duration, w, h, fps if 1 <= fps <= 240 else 30.0, rotation, has_audio,
                       ",".join(sorted(formats)), codec)


def extract_audio(src: Path, dest: Path, cancel: threading.Event | None = None) -> Path:
    """16 kHz mono WAV, the input format Whisper expects."""
    run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000",
         "-c:a", "pcm_s16le", str(dest)], timeout=1800, cancel=cancel)
    return dest


def audio_levels(wav_path: Path, window: float = 0.5) -> np.ndarray:
    """RMS level in dBFS per `window` seconds (used for audio quality / energy scoring)."""
    with wave.open(str(wav_path), "rb") as w:
        rate = w.getframerate()
        frames = w.readframes(w.getnframes())
    samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    hop = max(1, int(rate * window))
    n = len(samples) // hop
    if n == 0:
        return np.array([-90.0])
    chunks = samples[: n * hop].reshape(n, hop)
    rms = np.sqrt(np.mean(chunks**2, axis=1) + 1e-12)
    return 20 * np.log10(rms + 1e-9)


def thumbnail(video: Path, dest: Path, at: float) -> Path:
    run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-ss", f"{max(0.0, at):.3f}", "-i", str(video), "-frames:v", "1",
         "-vf", "scale=480:-2", "-q:v", "4", str(dest)], timeout=120)
    return dest


def validate_output(path: Path, expected_duration: float, width: int, height: int) -> ProbeResult:
    """A clip is only considered done once the final file passes these checks."""
    if not path.exists() or path.stat().st_size < 10_000:
        raise RuntimeError("rendered file missing or empty")
    p = probe(path)
    if abs(p.duration - expected_duration) > max(0.6, expected_duration * 0.03):
        raise RuntimeError(f"rendered duration {p.duration:.2f}s != expected {expected_duration:.2f}s")
    if (p.width, p.height) != (width, height):
        raise RuntimeError(f"rendered size {p.width}x{p.height} != expected {width}x{height}")
    return p
