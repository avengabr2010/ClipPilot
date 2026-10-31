import re

from clippilot_worker.subtitles import PRESETS, SubWord, build_ass, group_words, resolve_style, words_for_clip

WORDS = [SubWord(0.0, 0.4, "Bonjour"), SubWord(0.45, 0.8, "tout"), SubWord(0.85, 1.3, "le"), SubWord(1.35, 2.0, "monde.")]


def test_presets_mirror_web_copy():
    import json
    from pathlib import Path
    web = json.loads((Path(__file__).parents[2] / "web/src/lib/subtitle-presets.json").read_text())
    worker = json.loads((Path(__file__).parents[1] / "clippilot_worker/subtitle_presets.json").read_text())
    assert web == worker


def test_every_preset_builds_valid_ass():
    for pid in PRESETS:
        ass = build_ass(WORDS, resolve_style(pid, None), 720, 1280)
        assert "[Events]" in ass and "Dialogue:" in ass, pid
        assert "PlayResX: 720" in ass


def test_word_animation_highlights_each_word():
    style = resolve_style("bold", None)
    ass = build_ass(WORDS, style, 720, 1280)
    dialogues = [l for l in ass.splitlines() if l.startswith("Dialogue: 0")]
    assert len(dialogues) >= 4
    assert "BONJOUR" in ass  # uppercase preset


def test_karaoke_uses_kf_tags():
    ass = build_ass(WORDS, resolve_style("karaoke", None), 720, 1280)
    assert re.search(r"\\kf\d+", ass)


def test_watermark_and_disabled_subtitles():
    ass = build_ass(WORDS, resolve_style("classic", None), 720, 1280, enabled=False, watermark=True)
    assert "ClipPilot" in ass
    assert "Bonjour" not in ass


def test_overrides_are_applied_and_unknown_font_rejected():
    s = resolve_style("classic", {"color": "#FF0000", "font": "Comic Sans", "evil": 1})
    assert s["color"] == "#FF0000" and s["font"] == "Inter" and "evil" not in s


def test_braces_are_escaped():
    ass = build_ass([SubWord(0, 1, "{\\pos(0,0)}hack")], resolve_style("classic", None), 720, 1280)
    assert "{\\pos(0,0)}hack" not in ass


def test_words_for_clip_retimes():
    words = [{"start": 10.0, "end": 10.5, "text": "a"}, {"start": 20.0, "end": 20.4, "text": "b"}, {"start": 31, "end": 32, "text": "c"}]
    out = words_for_clip(words, 10.0, 30.0)
    assert [w.text for w in out] == ["a", "b"]
    assert out[0].start == 0.0 and abs(out[1].start - 10.0) < 1e-9


def test_grouping_respects_words_per_line():
    groups = group_words([SubWord(i * 0.3, i * 0.3 + 0.25, f"w{i}") for i in range(10)], 3)
    assert all(len(g) <= 3 for g in groups)


def test_merge_words_replaces_only_edited_span():
    from clippilot_worker.pipeline import merge_words
    tr = [{"start": i, "end": i + 0.5, "text": f"w{i}"} for i in range(10)]
    edited = [{"start": 3, "end": 3.5, "text": "X"}, {"start": 4, "end": 5.5, "text": "Y"}]
    out = merge_words(tr, edited)
    assert [w["text"] for w in out] == ["w0", "w1", "w2", "X", "Y", "w6", "w7", "w8", "w9"]
    assert merge_words(tr, []) == tr
