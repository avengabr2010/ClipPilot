"""Clip rendering with FFmpeg: trim, reframe, scale, burn subtitles, encode MP4."""
from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path

from . import media, reframe
from .subtitles import SubWord, build_ass


@dataclass
class RenderSpec:
    start: float
    end: float
    aspect: str  # 9:16 | 1:1 | 16:9
    resolution: int  # 720 | 1080
    style: dict
    words: list[SubWord]
    subtitles: bool
    watermark: bool
    crop_mode: str = "auto"  # auto | manual | center
    crop_x: float = 0.5  # manual centre 0..1
    zoom: float = 1.0
    keyframes: list[reframe.Keyframe] | None = None

    @property
    def duration(self) -> float:
        return self.end - self.start


def _esc_path(p: Path) -> str:
    # filtergraph-escape a path inside single quotes
    return str(p).replace("\\", "\\\\").replace("'", "\\'").replace(":", "\\:")


def build_filter(spec: RenderSpec, src_w: int, src_h: int, ass_path: Path, fonts_dir: Path) -> tuple[str, int, int]:
    out_w, out_h = reframe.output_size(spec.aspect, spec.resolution)
    cw, ch = reframe.crop_geometry(src_w, src_h, spec.aspect)
    if spec.zoom > 1.0:
        cw = int(cw / spec.zoom) // 2 * 2
        ch = int(ch / spec.zoom) // 2 * 2
    if cw < src_w:
        if spec.crop_mode == "auto" and spec.keyframes:
            x_expr = reframe.crop_x_expression(spec.keyframes, src_w, cw)
        else:
            cx = spec.crop_x if spec.crop_mode == "manual" else 0.5
            x_expr = str(round(min(src_w - cw, max(0, cx * src_w - cw / 2))))
    else:
        x_expr = "0"
    y_expr = str((src_h - ch) // 2)
    chain = [
        f"crop=w={cw}:h={ch}:x='{x_expr}':y={y_expr}",
        f"scale={out_w}:{out_h}:flags=lanczos",
        "setsar=1",
        "fps=30",
    ]
    if spec.subtitles or spec.watermark:
        chain.append(f"ass=filename='{_esc_path(ass_path)}':fontsdir='{_esc_path(fonts_dir)}'")
    chain.append("format=yuv420p")
    return ",".join(chain), out_w, out_h


def render_clip(src: Path, probe: media.ProbeResult, spec: RenderSpec, out: Path, work: Path, fonts_dir: Path,
                *, threads: int = 0, cancel: threading.Event | None = None) -> media.ProbeResult:
    src_w, src_h = probe.display_size
    out_w, out_h = reframe.output_size(spec.aspect, spec.resolution)
    ass_path = work / f"{out.stem}.ass"
    ass_path.write_text(build_ass(spec.words, spec.style, out_w, out_h, enabled=spec.subtitles, watermark=spec.watermark),
                        encoding="utf-8")
    vf, out_w, out_h = build_filter(spec, src_w, src_h, ass_path, fonts_dir)
    script = work / f"{out.stem}.filter"
    dur = spec.duration
    fade_out = max(0.0, dur - 0.08)
    graph = f"[0:v]{vf}[v]"
    if probe.has_audio:
        graph += f";[0:a]aresample=48000,afade=t=in:d=0.05,afade=t=out:st={fade_out:.3f}:d=0.08,loudnorm=I=-14:TP=-1.5:LRA=11[a]"
    script.write_text(graph, encoding="utf-8")
    crf = "20" if spec.resolution >= 1080 else "22"
    cmd = [
        "ffmpeg", "-nostdin", "-y", "-v", "error",
        "-ss", f"{spec.start:.3f}", "-i", str(src), "-t", f"{dur:.3f}",
        "-filter_complex_script", str(script), "-map", "[v]",
    ]
    if probe.has_audio:
        cmd += ["-map", "[a]", "-c:a", "aac", "-b:a", "160k", "-ar", "48000"]
    cmd += [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", crf, "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", "-threads", str(threads), str(out),
    ]
    media.run(cmd, timeout=max(300, dur * 20), cancel=cancel)
    return media.validate_output(out, dur, out_w, out_h)
