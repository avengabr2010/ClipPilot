from clippilot_worker import analysis
from clippilot_worker.analysis import build_sentences, detect_hook, select_clips


def test_sentences_follow_punctuation(fr_words):
    sents = build_sentences(fr_words)
    assert len(sents) >= 15
    assert all(s.text for s in sents)
    assert sents[0].text.endswith("?")


def test_hook_detection_types():
    assert detect_hook("Pourquoi la plupart des créateurs abandonnent ?")[0] == "question"
    assert detect_hook("Le secret, c'est de tester vite.")[0] == "curiosity"
    assert detect_hook("Un jour, j'ai décidé de tout arrêter.")[0] == "story"
    assert detect_hook("You won't believe what happened next.")[0] == "surprise"
    assert detect_hook("Résultat : 40 % de vues en plus.")[0] == "statistic"
    assert detect_hook("Il fait beau aujourd'hui.")[0] is None


def test_selection_respects_range_and_no_overlap(fr_words):
    clips = select_clips(fr_words, duration_range=(15, 30), count=3, style="dynamic")
    assert 1 <= len(clips) <= 3
    for c in clips:
        assert 14 <= c.duration <= 33, c.duration
        assert c.title and len(c.title) <= 120
        assert c.reasons is not None
    for i, a in enumerate(clips):
        for b in clips[i + 1:]:
            assert min(a.end, b.end) - max(a.start, b.start) <= 0.5


def test_selected_clips_start_and_end_on_sentence_boundaries(fr_words):
    clips = select_clips(fr_words, duration_range=(15, 30), count=3)
    starts = {round(w.start, 3) for w in fr_words}
    for c in clips:
        first = c.sentences[0].words[0]
        assert round(first.start, 3) in starts
        assert c.sentences[-1].terminal  # no abrupt endings in this script
        assert not analysis.CONNECTOR_START.search(analysis.normalise(c.sentences[0].text)), c.sentences[0].text


def test_best_clip_has_a_hook(fr_words):
    clips = select_clips(fr_words, duration_range=(15, 30), count=3)
    assert clips[0].hook_type is not None


def test_virality_is_bounded_and_explained(fr_words):
    clips = select_clips(fr_words, duration_range=(15, 30), count=3)
    for c in clips:
        v = analysis.virality_from_score(c.score)
        assert 5 <= v <= 98
        assert set(c.breakdown) == {"hook", "coherence", "interest", "context", "rhythm", "audio", "length"}
        assert analysis.explain(c)


def test_short_video_yields_single_clip():
    from tests.conftest import make_words
    words = make_words("Voici pourquoi il faut publier tous les jours. C'est la clé du succès.")
    clips = select_clips(words, duration_range=(30, 45), count=3)
    assert len(clips) <= 1


def test_empty_transcript():
    assert select_clips([], duration_range=(15, 30), count=3) == []
