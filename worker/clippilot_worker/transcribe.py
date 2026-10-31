"""Speech-to-text with faster-whisper (local, open source, no API cost).

Returns word-level timestamps, which drive clip boundaries and subtitles.
Speaker changes are approximated from long pauses + Whisper segment
boundaries (true diarisation would need pyannote and a HF token; it can be
plugged in here later without changing the rest of the pipeline).
"""
from __future__ import annotations

import logging
import threading
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

from .media import Cancelled

log = logging.getLogger(__name__)

_model = None
_model_lock = threading.Lock()


@dataclass
class Word:
    start: float
    end: float
    text: str
    prob: float = 1.0


@dataclass
class Segment:
    start: float
    end: float
    text: str
    speaker_turn: bool = False


@dataclass
class Transcript:
    language: str
    words: list[Word]
    segments: list[Segment]
    model: str

    @property
    def full_text(self) -> str:
        return " ".join(s.text.strip() for s in self.segments).strip()

    def words_json(self) -> list[dict]:
        return [{"start": round(w.start, 3), "end": round(w.end, 3), "text": w.text, "prob": round(w.prob, 3)} for w in self.words]

    def segments_json(self) -> list[dict]:
        return [asdict(s) | {"start": round(s.start, 3), "end": round(s.end, 3)} for s in self.segments]

    @staticmethod
    def from_json(language: str, words: list[dict], segments: list[dict], model: str = "stored") -> "Transcript":
        return Transcript(
            language=language or "und",
            words=[Word(float(w["start"]), float(w["end"]), str(w["text"]), float(w.get("prob", 1))) for w in words],
            segments=[Segment(float(s["start"]), float(s["end"]), str(s["text"]), bool(s.get("speaker_turn"))) for s in segments],
            model=model,
        )


def _get_model(name: str, device: str, compute_type: str, download_root: str | None):
    global _model
    with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel  # heavy import, lazy

            log.info("loading whisper model %s (%s/%s)", name, device, compute_type)
            _model = WhisperModel(name, device=device, compute_type=compute_type, download_root=download_root)
        return _model


def transcribe(
    wav: Path,
    *,
    language: str | None,
    model_name: str,
    device: str,
    compute_type: str,
    download_root: str | None,
    duration: float,
    on_progress: Callable[[float], None] | None = None,
    cancel: threading.Event | None = None,
) -> Transcript:
    model = _get_model(model_name, device, compute_type, download_root)
    segments_iter, info = model.transcribe(
        str(wav),
        language=None if language in (None, "", "auto") else language,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        beam_size=5,
        condition_on_previous_text=False,
    )
    words: list[Word] = []
    segments: list[Segment] = []
    prev_end = 0.0
    for seg in segments_iter:
        if cancel is not None and cancel.is_set():
            raise Cancelled("cancelled")
        seg_words = [Word(float(w.start), float(w.end), w.word.strip(), float(w.probability)) for w in (seg.words or []) if w.word.strip()]
        words.extend(seg_words)
        segments.append(Segment(float(seg.start), float(seg.end), seg.text.strip(), speaker_turn=(seg.start - prev_end) > 1.2))
        prev_end = float(seg.end)
        if on_progress and duration > 0:
            on_progress(min(1.0, seg.end / duration))
    return Transcript(language=info.language or (language or "und"), words=words, segments=segments, model=model_name)
