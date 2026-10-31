import subprocess
from pathlib import Path

import pytest

from clippilot_worker.transcribe import Word

FR_SCRIPT = (
    "Pourquoi la plupart des créateurs abandonnent après trois mois ? "
    "La réponse est simple et elle va vous surprendre. "
    "Ils publient sans stratégie et ils regardent les mauvais chiffres. "
    "Et donc ils se découragent très vite. "
    "Voici pourquoi la régularité compte plus que la perfection. "
    "Quand j'ai commencé, je publiais une vidéo par mois et personne ne regardait. "
    "Un jour, j'ai décidé de publier chaque jour pendant soixante jours. "
    "Résultat : quarante mille abonnés en deux mois, c'est incroyable ! "
    "Le secret, c'est de tester vite et d'apprendre de chaque vidéo. "
    "Par exemple, changez uniquement le début de la vidéo et comparez la rétention. "
    "Euh, bon, ça c'est un détail. "
    "Alors il faut aussi parler de l'audio, parce que le son compte énormément. "
    "Un mauvais micro fait fuir les spectateurs en quelques secondes. "
    "Investissez d'abord dans le son, ensuite dans l'image. "
    "Vous savez quelle est la plus grosse erreur des débutants ? "
    "Ils copient les autres au lieu de trouver leur propre voix. "
    "Trouvez votre angle, racontez vos histoires, et le public suivra."
)


def make_words(text: str, wps: float = 2.8, pause_every_sentence: float = 0.35) -> list[Word]:
    words: list[Word] = []
    t = 0.5
    for token in text.split():
        dur = 1.0 / wps
        words.append(Word(round(t, 3), round(t + dur * 0.85, 3), token))
        t += dur
        if token[-1] in ".?!":
            t += pause_every_sentence
    return words


@pytest.fixture
def fr_words() -> list[Word]:
    return make_words(FR_SCRIPT)


@pytest.fixture(scope="session")
def sample_video(tmp_path_factory) -> Path:
    """A 60s 1280x720 test video with a tone (real H.264/AAC MP4)."""
    out = tmp_path_factory.mktemp("media") / "sample.mp4"
    subprocess.run([
        "ffmpeg", "-nostdin", "-y", "-v", "error",
        "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=60",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=60",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(out),
    ], check=True)
    return out
