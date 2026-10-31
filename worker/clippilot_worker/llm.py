"""Optional LLM refinement (titles, re-ranking) via the Anthropic Messages API.

Only used when ANTHROPIC_API_KEY is set and the `llm_analysis` flag is on.
The local heuristic result is always computed first and kept as fallback:
an LLM failure never fails a job.
"""
from __future__ import annotations

import json
import logging
import re

import httpx

from .analysis import Candidate

log = logging.getLogger(__name__)

PROMPT = """Tu es éditeur vidéo pour TikTok, Reels et Shorts. Voici des extraits candidats d'une vidéo, avec leur transcription.
Pour chacun, propose un titre court et accrocheur (max 70 caractères, dans la langue de l'extrait, sans emoji, sans guillemets)
et une note d'intérêt de 0 à 10 (autonomie du passage, accroche du début, valeur pour le spectateur).
Réponds UNIQUEMENT en JSON : [{"id": <id>, "title": "...", "rating": <0-10>}]

Extraits :
"""


def refine(cands: list[Candidate], api_key: str, model: str, timeout: float = 45.0) -> list[Candidate]:
    if not cands:
        return cands
    payload = "\n\n".join(f"[id={i}] ({c.duration:.0f}s) {c.text[:1500]}" for i, c in enumerate(cands))
    try:
        r = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": model, "max_tokens": 1500, "messages": [{"role": "user", "content": PROMPT + payload}]},
            timeout=timeout,
        )
        r.raise_for_status()
        text = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")
        m = re.search(r"\[.*\]", text, re.S)
        items = json.loads(m.group(0)) if m else []
    except Exception as e:  # noqa: BLE001 — never fail the job because of the optional LLM
        log.warning("LLM refinement skipped: %s", e)
        return cands
    for it in items:
        try:
            c = cands[int(it["id"])]
        except (KeyError, ValueError, IndexError, TypeError):
            continue
        title = str(it.get("title", "")).strip().strip('"')[:120]
        if title:
            c.title = title
        rating = it.get("rating")
        if isinstance(rating, (int, float)) and 0 <= rating <= 10:
            c.score = 0.75 * c.score + 0.25 * (rating / 10)
            c.breakdown["llm"] = round(rating * 10)
    cands.sort(key=lambda c: c.score, reverse=True)
    return cands
