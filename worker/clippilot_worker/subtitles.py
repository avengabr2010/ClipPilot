"""ASS subtitle generation (burned in by libass through FFmpeg).

Supports the presets defined in subtitle_presets.json: word-by-word
highlight, karaoke, pop, background box, outline, uppercase, keyword
emphasis and a watermark for the Free plan.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from .analysis import STOPWORDS, normalise

PRESETS: dict[str, dict] = {p["id"]: p for p in json.loads((Path(__file__).parent / "subtitle_presets.json").read_text())}

FONTS = {"Inter", "Inter Display", "DejaVu Sans", "Liberation Sans", "JetBrains Mono"}


@dataclass
class SubWord:
    start: float
    end: float
    text: str


def resolve_style(template: str, overrides: dict | None) -> dict:
    base = dict(PRESETS.get(template, PRESETS["classic"])["style"])
    if overrides:
        for k, v in overrides.items():
            if k in base:
                base[k] = v
    if base["font"] not in FONTS:
        base["font"] = "Inter"
    return base


def _ass_color(hex_color: str, alpha: int = 0) -> str:
    """#RRGGBB -> &HAABBGGRR (ASS uses BGR + inverted alpha)."""
    h = hex_color.lstrip("#")
    if not re.fullmatch(r"[0-9a-fA-F]{6}", h):
        h = "FFFFFF"
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def _ts(t: float) -> str:
    t = max(0.0, t)
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t - h * 3600 - m * 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")").replace("\n", " ")


def _is_keyword(word: str) -> bool:
    n = normalise(word).strip(".,!?;:\"'")
    return bool(re.search(r"\d", n)) or (len(n) >= 7 and n not in STOPWORDS)


def group_words(words: list[SubWord], per_line: int, max_gap: float = 0.6) -> list[list[SubWord]]:
    groups: list[list[SubWord]] = []
    cur: list[SubWord] = []
    for i, w in enumerate(words):
        if cur and (len(cur) >= per_line or w.start - cur[-1].end > max_gap):
            groups.append(cur)
            cur = []
        cur.append(w)
        if w.text.rstrip()[-1:] in ".?!" and len(cur) >= 2:
            groups.append(cur)
            cur = []
    if cur:
        groups.append(cur)
    return groups


def build_ass(
    words: list[SubWord],
    style: dict,
    width: int,
    height: int,
    *,
    enabled: bool = True,
    watermark: bool = False,
) -> str:
    font_size = max(16, round(style["size"] * height))
    outline = style["outlineWidth"] * height / 1280
    bold = -1 if style["weight"] >= 700 else 0
    if style["background"]:
        # BorderStyle 4 (libass): one box per event drawn in BackColour; Outline = padding.
        border_style, outline_px = 4, max(6.0, font_size * 0.28)
        outline_col = _ass_color(style["backgroundColor"], 0xFF)
        back = _ass_color(style["backgroundColor"], 0x30)
    else:
        border_style, outline_px, back = 1, outline, _ass_color("#000000", 0x80)
        outline_col = _ass_color(style["outlineColor"])
    align = {"top": 8, "middle": 5, "bottom": 2}[style["position"]]
    margin_v = round(height * (0.12 if style["position"] != "middle" else 0.0))
    margin_h = round(width * 0.08)
    shadow = 0 if style["background"] else round(height / 640)

    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {width}",
        f"PlayResY: {height}",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Main,{style['font']},{font_size},{_ass_color(style['color'])},{_ass_color(style['highlightColor'])},"
        f"{outline_col},{back},{bold},0,0,0,100,100,0,0,{border_style},{outline_px:.1f},{shadow},{align},{margin_h},{margin_h},{margin_v},1",
        f"Style: Mark,Inter,{max(14, round(height * 0.022))},&H60FFFFFF,&H60FFFFFF,&H80000000,&H00000000,-1,0,0,0,100,100,1,0,1,1,0,9,"
        f"{round(width * 0.04)},{round(width * 0.04)},{round(height * 0.03)},1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]

    if watermark:
        end = max((w.end for w in words), default=3600.0) + 5
        lines.append(f"Dialogue: 1,{_ts(0)},{_ts(end)},Mark,,0,0,0,,Créé avec ClipPilot")

    if enabled and words:
        hi = _ass_color(style["highlightColor"])
        base = _ass_color(style["color"])
        anim = style["animation"]
        for group in group_words(words, int(style["wordsPerLine"])):
            texts = [_escape(w.text.upper() if style["uppercase"] else w.text) for w in group]
            g_start, g_end = group[0].start, group[-1].end
            if anim == "none":
                parts = []
                for w, t in zip(group, texts):
                    if style["highlightKeywords"] and _is_keyword(w.text):
                        parts.append(f"{{\\c{hi}}}{t}{{\\c{base}}}")
                    else:
                        parts.append(t)
                lines.append(f"Dialogue: 0,{_ts(g_start)},{_ts(g_end)},Main,,0,0,0,,{' '.join(parts)}")
                continue
            if anim == "karaoke":
                # \kf sweeps the SecondaryColour -> PrimaryColour; we invert so spoken words light up.
                parts = []
                for i, (w, t) in enumerate(zip(group, texts)):
                    nxt = group[i + 1].start if i + 1 < len(group) else w.end
                    dur_cs = max(1, round((nxt - w.start) * 100))
                    parts.append(f"{{\\kf{dur_cs}}}{t}")
                lead = max(0, round((group[0].start - g_start) * 100))
                text = (f"{{\\k{lead}}}" if lead else "") + " ".join(parts)
                lines.append(
                    f"Dialogue: 0,{_ts(g_start)},{_ts(g_end)},Main,,0,0,0,,{{\\1c{hi}\\2c{base}}}{text}"
                )
                continue
            # "word" and "pop": one event per word, active word highlighted (and scaled for pop)
            for i, w in enumerate(group):
                start = w.start
                end = group[i + 1].start if i + 1 < len(group) else g_end
                if end <= start:
                    continue
                parts = []
                for j, t in enumerate(texts):
                    if j == i:
                        if anim == "pop":
                            parts.append(f"{{\\c{hi}\\fscx100\\fscy100\\t(0,90,\\fscx118\\fscy118)\\t(90,180,\\fscx108\\fscy108)}}{t}{{\\c{base}\\fscx100\\fscy100}}")
                        else:
                            parts.append(f"{{\\c{hi}}}{t}{{\\c{base}}}")
                    else:
                        parts.append(t)
                lines.append(f"Dialogue: 0,{_ts(start)},{_ts(end)},Main,,0,0,0,,{' '.join(parts)}")
    return "\n".join(lines) + "\n"


def words_for_clip(words: list[dict], start: float, end: float) -> list[SubWord]:
    """Transcript words inside [start, end], re-timed relative to the clip start."""
    out: list[SubWord] = []
    for w in words:
        ws, we = float(w["start"]), float(w["end"])
        if we <= start or ws >= end:
            continue
        text = str(w["text"]).strip()
        if not text:
            continue
        out.append(SubWord(max(0.0, ws - start), min(end, we) - start, text))
    return out
