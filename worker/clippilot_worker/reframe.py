"""Smart reframing: face detection, active-speaker heuristic and smooth camera path.

1. Sample frames (~3 fps) inside the clip and detect faces (OpenCV DNN-free
   Haar cascade: bundled with OpenCV, CPU-only, no download).
2. When several faces are visible, prefer the one whose mouth region moves
   the most (cheap active-speaker proxy), with hysteresis to avoid ping-pong.
3. Smooth the target path (median + dead zone + velocity cap) and emit
   keyframes, converted to an FFmpeg `crop` expression with eased moves.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

log = logging.getLogger(__name__)

_cascade: cv2.CascadeClassifier | None = None


def _detector() -> cv2.CascadeClassifier:
    global _cascade
    if _cascade is None:
        _cascade = cv2.CascadeClassifier(str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"))
    return _cascade


@dataclass
class Keyframe:
    t: float
    x: float  # crop centre, normalised 0..1 of source width


def crop_geometry(src_w: int, src_h: int, aspect: str) -> tuple[int, int]:
    """Largest crop of the requested aspect that fits the source (even sizes)."""
    num, den = (int(v) for v in aspect.split(":"))
    target = num / den
    if src_w / src_h > target:
        cw, ch = int(src_h * target), src_h
    else:
        cw, ch = src_w, int(src_w / target)
    return cw - cw % 2, ch - ch % 2


def output_size(aspect: str, resolution: int) -> tuple[int, int]:
    short = resolution
    long = round(short * 16 / 9)
    long -= long % 2
    return {"9:16": (short, long), "1:1": (short, short), "16:9": (long, short)}[aspect]


def track_faces(video: Path, start: float, end: float, fps: float = 3.0, speaker_tracking: bool = True) -> list[tuple[float, float | None]]:
    """Returns [(t_rel, centre_x_norm | None)] samples."""
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        return []
    det = _detector()
    samples: list[tuple[float, float | None]] = []
    prev_gray: np.ndarray | None = None
    current: float | None = None
    t = start
    step = 1.0 / fps
    try:
        while t < end:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, frame = cap.read()
            if not ok:
                break
            h, w = frame.shape[:2]
            scale = 480 / max(w, h)
            small = cv2.resize(frame, (int(w * scale), int(h * scale)))
            gray = cv2.equalizeHist(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY))
            min_side = max(24, int(min(small.shape[:2]) * 0.07))
            faces = det.detectMultiScale(gray, scaleFactor=1.12, minNeighbors=6, minSize=(min_side, min_side))
            cx: float | None = None
            if len(faces):
                sw = small.shape[1]
                scored = []
                for (fx, fy, fw, fh) in faces:
                    centre = (fx + fw / 2) / sw
                    size = fw * fh
                    motion = 0.0
                    if speaker_tracking and prev_gray is not None and prev_gray.shape == gray.shape:
                        my0, my1 = fy + int(fh * 0.6), fy + fh
                        mouth_now = gray[my0:my1, fx : fx + fw].astype(np.float32)
                        mouth_prev = prev_gray[my0:my1, fx : fx + fw].astype(np.float32)
                        if mouth_now.size:
                            motion = float(np.mean(np.abs(mouth_now - mouth_prev)))
                    # bigger faces and moving mouths win; stick to current target (hysteresis)
                    stick = 1.25 if current is not None and abs(centre - current) < 0.08 else 1.0
                    scored.append(((size ** 0.5) * (1 + motion / 6) * stick, centre))
                cx = max(scored)[1]
                current = cx
            samples.append((t - start, cx))
            prev_gray = gray
            t += step
    finally:
        cap.release()
    return samples


def smooth_path(samples: list[tuple[float, float | None]], crop_frac: float, dead_zone: float = 0.06,
                min_hold: float = 1.2) -> list[Keyframe]:
    """Turns noisy samples into stable keyframes (camera only moves when needed)."""
    half = crop_frac / 2
    clamp = lambda v: min(1 - half, max(half, v))  # noqa: E731
    xs = [x for _, x in samples]
    # fill gaps (no face) with last known value, or centre
    filled: list[float] = []
    last = next((x for x in xs if x is not None), 0.5)
    for x in xs:
        if x is not None:
            last = x
        filled.append(last)
    if not filled:
        return [Keyframe(0.0, 0.5)]
    arr = np.array(filled)
    k = 5
    if len(arr) >= k:
        pad = np.pad(arr, (k // 2, k // 2), mode="edge")
        arr = np.array([np.median(pad[i : i + k]) for i in range(len(arr))])
    frames = [Keyframe(0.0, clamp(float(arr[0])))]
    for (t, _), x in zip(samples, arr):
        x = clamp(float(x))
        if abs(x - frames[-1].x) > dead_zone * (1 + crop_frac) and t - frames[-1].t >= min_hold:
            frames.append(Keyframe(t, x))
    return frames[:80]


def crop_x_expression(frames: list[Keyframe], src_w: int, crop_w: int, move: float = 0.5) -> str:
    """FFmpeg expression for crop x: hold each keyframe, ease to the next over `move` s."""
    max_x = src_w - crop_w

    def px(f: Keyframe) -> float:
        return round(min(max_x, max(0.0, f.x * src_w - crop_w / 2)), 1)

    if len(frames) == 1:
        return str(px(frames[0]))
    expr = str(px(frames[-1]))
    for prev, cur in reversed(list(zip(frames, frames[1:]))):
        a, b = px(prev), px(cur)
        t0, t1 = cur.t, cur.t + move
        # smoothstep ease between a and b during [t0, t1]
        ease = f"({a}+({b}-{a})*(3*pow((t-{t0})/{move},2)-2*pow((t-{t0})/{move},3)))"
        expr = f"if(lt(t,{t0}),{a},if(lt(t,{t1}),{ease},{expr}))"
    # the nested chain above is built back to front; the first segment holds frames[0]
    return expr
