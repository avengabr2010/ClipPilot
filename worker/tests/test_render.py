import subprocess

import numpy as np
import pytest

from clippilot_worker import media, reframe
from clippilot_worker.config import PACKAGE_DIR
from clippilot_worker.render import RenderSpec, render_clip
from clippilot_worker.subtitles import SubWord, resolve_style

FONTS = PACKAGE_DIR.parent / "fonts"


def frame_at(path, t):
    out = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(t), "-i", str(path), "-frames:v", "1", "-f", "rawvideo",
                          "-pix_fmt", "gray", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.uint8)


def test_probe(sample_video):
    p = media.probe(sample_video)
    assert p.width == 1280 and p.height == 720 and p.has_audio
    assert 59 < p.duration < 61


def test_probe_rejects_non_video(tmp_path):
    bad = tmp_path / "fake.mp4"
    bad.write_bytes(b"not a video" * 1000)
    with pytest.raises(media.MediaError):
        media.probe(bad)


@pytest.mark.parametrize("aspect,res,size", [("9:16", 720, (720, 1280)), ("1:1", 720, (720, 720)), ("16:9", 1080, (1920, 1080))])
def test_render_formats(sample_video, tmp_path, aspect, res, size):
    probe = media.probe(sample_video)
    spec = RenderSpec(start=5.0, end=12.0, aspect=aspect, resolution=res, style=resolve_style("bold", None),
                      words=[SubWord(0.2, 1.0, "Bonjour"), SubWord(1.1, 2.0, "ClipPilot")], subtitles=True, watermark=True)
    out = tmp_path / f"clip-{aspect.replace(':', 'x')}.mp4"
    result = render_clip(sample_video, probe, spec, out, tmp_path, FONTS)
    assert (result.width, result.height) == size
    assert abs(result.duration - 7.0) < 0.6
    assert result.has_audio


def test_subtitles_are_burned_in(sample_video, tmp_path):
    probe = media.probe(sample_video)
    base = dict(start=5.0, end=9.0, aspect="9:16", resolution=720, style=resolve_style("classic", None),
                words=[SubWord(0.0, 4.0, "SOUS-TITRE VISIBLE")], watermark=False)
    a = render_clip(sample_video, probe, RenderSpec(subtitles=True, **base), tmp_path / "a.mp4", tmp_path, FONTS)
    b = render_clip(sample_video, probe, RenderSpec(subtitles=False, **base), tmp_path / "b.mp4", tmp_path, FONTS)
    assert a and b
    fa, fb = frame_at(tmp_path / "a.mp4", 2.0), frame_at(tmp_path / "b.mp4", 2.0)
    assert np.mean(np.abs(fa.astype(int) - fb.astype(int))) > 0.5


def test_auto_crop_expression_renders(sample_video, tmp_path):
    probe = media.probe(sample_video)
    kfs = [reframe.Keyframe(0.0, 0.3), reframe.Keyframe(2.0, 0.7), reframe.Keyframe(4.0, 0.5)]
    spec = RenderSpec(start=0, end=6, aspect="9:16", resolution=720, style=resolve_style("classic", None), words=[],
                      subtitles=False, watermark=False, crop_mode="auto", keyframes=kfs)
    r = render_clip(sample_video, probe, spec, tmp_path / "c.mp4", tmp_path, FONTS)
    assert (r.width, r.height) == (720, 1280)


def test_manual_crop_and_zoom(sample_video, tmp_path):
    probe = media.probe(sample_video)
    spec = RenderSpec(start=0, end=4, aspect="1:1", resolution=720, style=resolve_style("classic", None), words=[],
                      subtitles=False, watermark=False, crop_mode="manual", crop_x=0.1, zoom=1.5)
    r = render_clip(sample_video, probe, spec, tmp_path / "m.mp4", tmp_path, FONTS)
    assert (r.width, r.height) == (720, 720)


def test_smooth_path_is_stable():
    samples = [(i / 3, 0.5 + (0.01 if i % 2 else -0.01)) for i in range(30)]  # jitter only
    kf = reframe.smooth_path(samples, crop_frac=0.3)
    assert len(kf) == 1  # no camera shake from jitter
    samples = [(i / 3, 0.25 if i < 15 else 0.75) for i in range(30)]  # real move
    kf = reframe.smooth_path(samples, crop_frac=0.3)
    assert len(kf) == 2 and kf[1].x > 0.6


def test_geometry():
    assert reframe.crop_geometry(1920, 1080, "9:16") == (606, 1080)
    assert reframe.crop_geometry(1080, 1920, "16:9") == (1080, 606)
    assert reframe.output_size("9:16", 1080) == (1080, 1920)


def test_face_tracking_runs_without_faces(sample_video):
    samples = reframe.track_faces(sample_video, 0, 3)
    assert len(samples) >= 8
