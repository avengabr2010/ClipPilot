"""E2E harness: runs the REAL worker loop against a live Supabase stack, but
replaces the speech-recognition step with a fixed French transcript.

Use only where Whisper models cannot be downloaded (e.g. sandboxed CI).
Everything else — job claiming, storage download/upload, quotas, analysis,
reframing, FFmpeg rendering, validation — is the production code path.

    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python -m tests.e2e.run_worker_with_fixture_transcript
"""
from __future__ import annotations

import logging

from clippilot_worker import main as worker_main
from clippilot_worker import pipeline
from clippilot_worker.config import Config
from clippilot_worker.transcribe import Segment, Transcript
from tests.conftest import FR_SCRIPT, make_words


def fake_transcribe(*_args, **_kwargs) -> Transcript:
    words = make_words(FR_SCRIPT, wps=2.6)
    return Transcript(language="fr", words=words, segments=[Segment(words[0].start, words[-1].end, FR_SCRIPT)], model="e2e-fixture")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    pipeline.transcribe = fake_transcribe
    worker_main.run(Config.from_env())
