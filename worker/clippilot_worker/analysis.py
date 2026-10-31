"""Clip detection: sentences -> candidate windows -> scoring -> selection.

Runs fully locally (no paid API). Optionally refined by an LLM (see llm.py).

Scores are *indicative*. The virality score is an explainable heuristic
built from the transcript and audio, never a prediction of performance.
"""
from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field

import numpy as np

from .transcribe import Word

# ---------------------------------------------------------------------------
# Lexicons (FR + EN, extendable). Patterns are matched on normalised text
# (lowercase, accents stripped).
# ---------------------------------------------------------------------------
HOOK_PATTERNS: dict[str, list[str]] = {
    "question": [
        r"^(pourquoi|comment|est-ce que|qu'est-ce|que se passe|quel|quelle|combien|savez-vous|vous savez|tu sais|"
        r"why|how|what|what's|did you|do you|have you|ever wondered|is it|can you|would you)\b",
    ],
    "surprise": [
        r"\b(vous n'allez pas|tu vas pas|incroyable|personne ne|on ne vous dit|la verite|choquant|jamais vu|"
        r"you won't believe|nobody|no one tells|the truth|shocking|insane|crazy|unbelievable|plot twist)\b",
    ],
    "story": [
        r"^(un jour|quand j'etais|je me souviens|il y a \w+ ans|l'histoire|laisse-moi te raconter|"
        r"one day|when i was|i remember|years ago|story time|let me tell you)\b",
    ],
    "bold_claim": [
        r"\b(la plus grosse erreur|le meilleur|le pire|tout le monde|arretez de|il faut arreter|jamais|toujours|"
        r"the biggest mistake|the best|the worst|everyone|stop doing|never|always|the only)\b",
    ],
    "curiosity": [
        r"\b(voici pourquoi|voila pourquoi|le secret|ce que personne|la raison|ce qui se passe|attendez|"
        r"here's why|here is why|the secret|the reason|what happens|wait until|here's the thing)\b",
    ],
    "statistic": [r"\b\d+([.,]\d+)?\s?(%|pour ?cent|percent|millions?|milliards?|billions?|k\b|euros?|dollars?|€|\$)"],
}

HOOK_LABELS = {
    "question": "Commence par une question qui interpelle",
    "surprise": "Ouvre sur une affirmation surprenante",
    "story": "Démarre par une anecdote",
    "bold_claim": "Ouvre sur une affirmation forte",
    "curiosity": "Crée une attente (« voici pourquoi… »)",
    "statistic": "Commence par un chiffre marquant",
}

CONNECTOR_START = re.compile(
    r"^(et|mais|donc|alors|du coup|parce que|car|puis|ensuite|enfin|ou|bref|"
    r"and|but|so|because|then|or|also|anyway)\b"
)
DANGLING_START = re.compile(r"^(il|elle|ils|elles|ca|cela|ce|celui|celle|it|that|this|they|he|she|those|these)\b")
EMOTION = re.compile(
    r"\b(incroyable|fou|dingue|genial|terrible|peur|adore|deteste|choque|honte|fier|heureux|triste|enorme|"
    r"amazing|crazy|insane|love|hate|scared|afraid|proud|happy|sad|huge|awesome|terrible|wow|omg)\b"
)
EXPLANATION = re.compile(
    r"\b(parce que|c'est-a-dire|en fait|par exemple|la cle|l'astuce|etape|premierement|deuxiemement|"
    r"because|for example|the key|the trick|step|first|second|that means|in other words)\b"
)
ADDRESS = re.compile(r"\b(vous|tu|toi|ton|ta|tes|votre|vos|you|your)\b")
FILLERS = {"euh", "heu", "hum", "bah", "ben", "um", "uh", "erm", "hmm", "like"}
STOPWORDS = set(
    """le la les un une des de du d l et a au aux en dans sur pour par avec sans ce cet cette ces se sa son ses
    leur leurs mon ma mes ton ta tes nos vos notre votre qui que quoi dont ou est sont etre avoir ai as a avons
    avez ont fait faire je tu il elle on nous vous ils elles me te moi toi lui y ne pas plus tres tout tous
    toute toutes mais donc or ni car si alors comme c ca cela ceci j n s t qu oui non bon bien voila
    the a an and or but of to in on at for with without by from is are was were be been being have has had do
    does did i you he she it we they me him her us them my your his its our their this that these those so
    not no yes just very really like what which who whom there here then than also too can could will would
    should about into over out up down if as get got going gonna""".split()
)

STYLE_WEIGHTS: dict[str, dict[str, float]] = {
    # hook, coherence, interest, context, rhythm, audio, length
    "dynamic": dict(hook=0.28, coherence=0.14, interest=0.18, context=0.12, rhythm=0.14, audio=0.07, length=0.07),
    "minimal": dict(hook=0.20, coherence=0.20, interest=0.18, context=0.16, rhythm=0.10, audio=0.08, length=0.08),
    "podcast": dict(hook=0.18, coherence=0.22, interest=0.22, context=0.18, rhythm=0.06, audio=0.07, length=0.07),
    "gaming": dict(hook=0.24, coherence=0.10, interest=0.26, context=0.08, rhythm=0.16, audio=0.10, length=0.06),
    "educational": dict(hook=0.16, coherence=0.24, interest=0.22, context=0.20, rhythm=0.06, audio=0.06, length=0.06),
}


def normalise(text: str) -> str:
    t = unicodedata.normalize("NFKD", text.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return t.replace("’", "'").strip()


def tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", normalise(text))


def content_words(text: str) -> list[str]:
    return [t for t in tokens(text) if len(t) > 2 and t not in STOPWORDS and t not in FILLERS]


# ---------------------------------------------------------------------------
# Sentences
# ---------------------------------------------------------------------------
@dataclass
class Sentence:
    start: float
    end: float
    words: list[Word]

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words).replace(" ,", ",").replace(" .", ".").strip()

    @property
    def terminal(self) -> bool:
        return bool(self.words) and self.words[-1].text.rstrip()[-1:] in ".?!…"


def build_sentences(words: list[Word], pause: float = 0.75, max_len: float = 20.0) -> list[Sentence]:
    """Groups words into sentences using punctuation, pauses and a length cap."""
    sentences: list[Sentence] = []
    cur: list[Word] = []
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        ends_punct = w.text.rstrip()[-1:] in ".?!…"
        gap = (nxt.start - w.end) if nxt else 99
        too_long = cur[-1].end - cur[0].start > max_len and w.text.rstrip()[-1:] in ",;:"
        if ends_punct or gap >= pause or too_long or nxt is None:
            sentences.append(Sentence(cur[0].start, cur[-1].end, cur))
            cur = []
    # hard split of pathological run-ons (no punctuation, no pauses)
    out: list[Sentence] = []
    for s in sentences:
        if s.end - s.start <= max_len * 1.6:
            out.append(s)
            continue
        chunk: list[Word] = []
        for w in s.words:
            chunk.append(w)
            if chunk[-1].end - chunk[0].start >= max_len:
                out.append(Sentence(chunk[0].start, chunk[-1].end, chunk))
                chunk = []
        if chunk:
            out.append(Sentence(chunk[0].start, chunk[-1].end, chunk))
    return out


# ---------------------------------------------------------------------------
# Candidates & scoring
# ---------------------------------------------------------------------------
@dataclass
class Candidate:
    start: float
    end: float
    sentences: list[Sentence]
    score: float = 0.0
    breakdown: dict[str, float] = field(default_factory=dict)
    hook_type: str | None = None
    hook_text: str = ""
    reasons: list[str] = field(default_factory=list)
    title: str = ""

    @property
    def duration(self) -> float:
        return self.end - self.start

    @property
    def text(self) -> str:
        return " ".join(s.text for s in self.sentences).strip()

    @property
    def words(self) -> list[Word]:
        return [w for s in self.sentences for w in s.words]


def detect_hook(first_sentence: str) -> tuple[str | None, float]:
    """Returns (hook_type, strength 0..1) for the opening sentence."""
    t = normalise(first_sentence)
    best: tuple[str | None, float] = (None, 0.0)
    weights = {"question": 0.85, "surprise": 0.95, "story": 0.8, "bold_claim": 0.75, "curiosity": 0.9, "statistic": 0.8}
    for kind, pats in HOOK_PATTERNS.items():
        for p in pats:
            if re.search(p, t):
                strength = weights[kind]
                if strength > best[1]:
                    best = (kind, strength)
    if best[0] is None and first_sentence.rstrip().endswith("?"):
        best = ("question", 0.7)
    if best[0] is not None and len(tokens(first_sentence)) > 28:
        best = (best[0], best[1] * 0.8)  # a hook buried in a long sentence is weaker
    return best


def _window_candidates(sentences: list[Sentence], dmin: float, dmax: float) -> list[Candidate]:
    cands: list[Candidate] = []
    n = len(sentences)
    for i in range(n):
        j = i
        while j < n:
            dur = sentences[j].end - sentences[i].start
            if dur > dmax + 2.0:
                break
            if dur >= dmin:
                cands.append(Candidate(sentences[i].start, sentences[j].end, sentences[i : j + 1]))
            j += 1
    return cands


def score_candidate(
    c: Candidate,
    *,
    dmin: float,
    dmax: float,
    style: str,
    topic: Counter,
    levels: np.ndarray | None,
    level_window: float,
    global_level: float,
) -> None:
    words = c.words
    text_norm = normalise(c.text)
    first = c.sentences[0].text
    first_norm = normalise(first)
    reasons: list[str] = []

    # Hook --------------------------------------------------------------
    hook_type, hook = detect_hook(first)
    c.hook_type, c.hook_text = hook_type, first if hook_type else ""
    if hook_type:
        reasons.append(HOOK_LABELS[hook_type])
    else:
        hook = 0.25

    # Coherence: clean start/end ------------------------------------------
    coherence = 0.5
    if c.sentences[-1].terminal:
        coherence += 0.3
    else:
        reasons.append("Fin de phrase approximative")
    if not CONNECTOR_START.search(first_norm):
        coherence += 0.2
    else:
        coherence -= 0.2
    coherence = max(0.0, min(1.0, coherence))

    # Context independence ----------------------------------------------
    context = 1.0
    if DANGLING_START.search(first_norm):
        context -= 0.4
    if CONNECTOR_START.search(first_norm):
        context -= 0.3
    if context >= 0.9:
        reasons.append("Compréhensible sans contexte")
    context = max(0.0, context)

    # Interest: topic relevance + emotion + explanations + address ---------
    cw = content_words(c.text)
    total_topic = sum(topic.values()) or 1
    topic_hits = sum(topic[w] for w in set(cw)) / total_topic
    uniq_ratio = len(set(cw)) / max(1, len(cw))
    emo = len(EMOTION.findall(text_norm))
    expl = len(EXPLANATION.findall(text_norm))
    addr = len(ADDRESS.findall(text_norm))
    excl = c.text.count("!")
    interest = (
        0.30 * min(1.0, topic_hits * 12)
        + 0.20 * uniq_ratio
        + 0.20 * min(1.0, emo / 2 + excl / 4)
        + (0.20 if style == "educational" else 0.15) * min(1.0, expl / 2)
        + 0.15 * min(1.0, addr / 3)
    )
    interest = min(1.0, interest / 0.9)
    if emo or excl >= 2:
        reasons.append("Moment chargé en émotion")
    if expl:
        reasons.append("Contient une explication claire")

    # Rhythm: words/sec and long pauses ---------------------------------------
    speech = sum(w.end - w.start for w in words)
    wps = len(words) / max(1.0, c.duration)
    gaps = [b.start - a.end for a, b in zip(words, words[1:])]
    long_pauses = sum(1 for g in gaps if g > 1.2)
    fillers = sum(1 for w in words if normalise(w.text).strip(".,!?") in FILLERS)
    rhythm = 1.0 - min(1.0, abs(wps - 2.9) / 2.2) - 0.12 * long_pauses - 0.05 * fillers
    rhythm = max(0.0, min(1.0, rhythm * 0.6 + (speech / max(1.0, c.duration)) * 0.4))
    if wps >= 2.6 and long_pauses == 0:
        reasons.append(f"Rythme soutenu ({wps:.1f} mots/s)".replace(".", ","))

    # Audio: loudness relative to the whole video, energy variance ---------------
    audio = 0.6
    if levels is not None and len(levels):
        a = int(c.start / level_window)
        b = max(a + 1, int(c.end / level_window))
        seg = levels[a:b]
        if len(seg):
            mean = float(np.mean(seg))
            audio = 0.7 - min(0.5, max(0.0, (global_level - mean) / 20))  # quieter than average -> penalty
            if mean < -45:
                audio -= 0.3
            energy = float(np.std(seg))
            if style == "gaming":
                audio += min(0.3, energy / 30)
            audio = max(0.0, min(1.0, audio + 0.15))

    # Length: closeness to the middle of the requested range ------------------
    mid = (dmin + dmax) / 2
    half = (dmax - dmin) / 2 or 1
    length = max(0.0, 1.0 - abs(c.duration - mid) / (half * 2.5))
    if c.duration > dmax:
        length *= 0.6

    w = STYLE_WEIGHTS.get(style, STYLE_WEIGHTS["dynamic"])
    parts = dict(hook=hook, coherence=coherence, interest=interest, context=context, rhythm=rhythm, audio=audio, length=length)
    total = sum(w[k] * v for k, v in parts.items())
    c.score = total
    c.breakdown = {k: round(v * 100) for k, v in parts.items()}
    c.reasons = reasons


def _overlap(a: Candidate, b: Candidate) -> float:
    inter = max(0.0, min(a.end, b.end) - max(a.start, b.start))
    return inter / max(1e-6, min(a.duration, b.duration))


def _similarity(a: Candidate, b: Candidate) -> float:
    sa, sb = set(content_words(a.text)), set(content_words(b.text))
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def make_title(c: Candidate, max_words: int = 9) -> str:
    """Heuristic title: the hook sentence if short, else the most topical sentence, trimmed."""
    source = c.hook_text if c.hook_text and len(tokens(c.hook_text)) <= 14 else ""
    if not source:
        best, best_score = c.sentences[0].text, -1.0
        for s in c.sentences:
            cw = content_words(s.text)
            sc = len(set(cw)) + (2 if s.text.rstrip().endswith("?") else 0)
            if 3 <= len(tokens(s.text)) and sc > best_score:
                best, best_score = s.text, sc
        source = best
    words = [w for w in source.split() if normalise(w).strip(".,!?") not in FILLERS]
    words = words[:max_words]
    title = " ".join(words).strip(" ,;:-")
    if len(source.split()) > max_words:
        title = title.rstrip(".?!") + "…"
    title = title[:1].upper() + title[1:]
    return title[:120] or "Clip"


def virality_from_score(score: float) -> int:
    # Spread the raw 0..1 score over a readable 5..98 range.
    return int(max(5, min(98, round(100 * (1 / (1 + math.exp(-7 * (score - 0.52))))))))


def select_clips(
    words: list[Word],
    *,
    duration_range: tuple[float, float],
    count: int,
    style: str = "dynamic",
    levels: np.ndarray | None = None,
    level_window: float = 0.5,
    video_duration: float | None = None,
) -> list[Candidate]:
    dmin, dmax = duration_range
    sentences = build_sentences(words)
    if not sentences:
        return []
    cands = _window_candidates(sentences, dmin, dmax)
    if not cands:
        # Video shorter than the requested range: one clip of everything usable.
        whole = Candidate(sentences[0].start, sentences[-1].end, sentences)
        if whole.duration >= min(dmin, 8):
            cands = [whole]
    topic = Counter(content_words(" ".join(s.text for s in sentences)))
    for wrd in list(topic):
        if topic[wrd] < 2:
            del topic[wrd]
    global_level = float(np.median(levels)) if levels is not None and len(levels) else -20.0
    for c in cands:
        score_candidate(c, dmin=dmin, dmax=dmax, style=style, topic=topic, levels=levels,
                        level_window=level_window, global_level=global_level)

    cands.sort(key=lambda c: c.score, reverse=True)
    chosen: list[Candidate] = []
    for c in cands:
        if len(chosen) >= count:
            break
        if any(_overlap(c, o) > 0.15 or _similarity(c, o) > 0.55 for o in chosen):
            continue
        chosen.append(c)

    for c in chosen:
        # tiny padding so the first/last syllable is never clipped
        c.start = max(0.0, c.start - 0.15)
        c.end = c.end + 0.25 if video_duration is None else min(video_duration, c.end + 0.25)
        c.title = make_title(c)
    return chosen


def explain(c: Candidate) -> str:
    reasons = list(dict.fromkeys(c.reasons))
    if not reasons:
        reasons = ["Passage cohérent et bien rythmé"]
    return " · ".join(reasons[:4])
