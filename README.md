# ClipPilot

> **Une longue vidéo. Plusieurs clips. Zéro montage.**

ClipPilot est un micro-SaaS qui transforme automatiquement des vidéos longues (podcasts, interviews, vlogs, cours, streams) en clips courts sous-titrés et recadrés pour TikTok, Instagram Reels et YouTube Shorts.

Ce dépôt contient l'application complète : site marketing, application web responsive (PWA), API, base de données avec RLS, et workers de traitement vidéo.

## Fonctionnalités

| Domaine | Ce qui est implémenté |
| --- | --- |
| Import | Glisser-déposer / galerie mobile, MP4·MOV·WEBM, vérif. format/taille/durée côté client **et** serveur, upload direct résumable (TUS) avec progression, annulation et reprise |
| Moteur IA | Transcription locale (faster-whisper, horodatage au mot) → phrases → fenêtres candidates → score multicritère (accroche, cohérence, intérêt, autonomie, rythme, audio, longueur) → sélection sans chevauchement ni redondance → titres et justifications. Affinage LLM optionnel |
| Hook Detector | Question, affirmation surprenante, anecdote, affirmation forte, curiosité, chiffre (FR + EN) |
| Virality Score | Score 5–98 **indicatif et expliqué** (détail par critère), jamais présenté comme une garantie |
| Montage | FFmpeg : découpe précise, 9:16 / 1:1 / 16:9, 720p/1080p, sous-titres ASS incrustés (7 modèles, karaoké, pop, mot actif, fond, contour…), normalisation audio, filigrane Free, validation du MP4 final avant de le marquer prêt |
| Recadrage | Détection de visages (OpenCV), heuristique de locuteur actif, trajectoire lissée (zone morte, easing), correction manuelle (position + zoom, glisser sur l'aperçu) |
| Éditeur | Aperçu live (recadrage + sous-titres), timeline avec poignées début/fin, ajustements ±0,1 s, correction du texte, styles, format, réexport, téléchargement — ordinateur et mobile |
| Bibliothèque | Recherche, filtres (projet, statut), tris (date, durée, score), renommage, suppression, téléchargement, organisation par projet |
| Comptes | Inscription, vérification e-mail, connexion, mot de passe oublié, profil, changement de mot de passe, suppression de compte |
| Offres & crédits | Free / Starter / Creator configurables, quotas minutes + clips par période, grand livre des transactions, remboursement automatique en cas d'échec, Stripe Checkout + portail (désactivé tant que non configuré) |
| Rôles | OWNER (premium illimité gratuit, défini par `OWNER_EMAIL`), ADMIN, USER — protections en base contre l'auto-attribution |
| Administration | Statistiques réelles, utilisateurs, rôles, offres, crédits, limites, feature flags, tâches (relance), journaux, état des services, espace de test Premium |
| Infra | File de jobs Postgres (`SKIP LOCKED`), workers scalables horizontalement, retry exponentiel, heartbeats, timeouts, annulation, nettoyage automatique |

## Démarrage rapide

```bash
# 1. Base de données + auth + stockage (Docker requis)
npx supabase start                    # applique supabase/migrations

# 2. Application web
cd web && cp ../.env.example .env.local   # renseigner les clés affichées par `supabase start`
npm install && npm run dev                 # http://localhost:3000
npm run owner:init                         # enregistre OWNER_EMAIL

# 3. Worker vidéo (FFmpeg requis)
cd ../worker && python -m venv .venv && .venv/bin/pip install -r requirements.txt
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... .venv/bin/python -m clippilot_worker.main
```

Guide complet : [docs/INSTALLATION.md](docs/INSTALLATION.md).

## Documentation

- [INSTALLATION.md](docs/INSTALLATION.md) — installation locale, Supabase, FFmpeg, Whisper, OWNER
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — composants, pipeline, file de jobs, choix techniques
- [API.md](docs/API.md) — routes HTTP et fonctions SQL
- [SECURITY.md](docs/SECURITY.md) — modèle de sécurité, RLS, OWNER, crédits
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) — Vercel, Supabase Cloud, workers, Stripe
- [.env.example](.env.example) — toutes les variables

## Tests

```bash
bash scripts/db-test-setup.sh        # migrations sur un Postgres local (stubs Supabase)
cd web && npm test                   # 27 tests : sécurité DB/RLS/OWNER/crédits/queue + domaine
cd worker && .venv/bin/python -m pytest   # 35 tests : analyse, sous-titres, rendus FFmpeg réels, pipeline complet sur le vrai schéma
cd web && VIDEO=video.mp4 node tests/e2e/full-flow.mjs   # E2E navigateur sur une pile complète
cd web && node tests/e2e/responsive.mjs                   # 5 tailles d'écran, débordements, captures
```

## Structure

```
supabase/migrations/   schéma, fonctions métier, RLS, stockage, seed
web/                   Next.js 15 (App Router) + TypeScript + Tailwind + Radix/shadcn-style UI
  src/app/(marketing)  site public        src/app/(auth)  authentification
  src/app/(app)        application + admin src/app/api     routes API
  src/lib              domaine (entitlements, permissions, upload, presets), clients Supabase, Stripe
worker/                worker Python : FFmpeg, faster-whisper, OpenCV
scripts/               outillage (tests DB)
docs/                  documentation
```

## Limites connues (bêta)

- La diarisation est approximée (pauses + segments Whisper) ; un module pyannote peut être branché dans `transcribe.py`.
- Le suivi du locuteur repose sur une heuristique de mouvement de la bouche (Haar cascade) : efficace pour les plans fixes type podcast, moins pour les plans très dynamiques — la correction manuelle reste disponible.
- Les avis clients ne sont pas affichés tant qu'il n'existe pas d'avis authentiques.
- Les textes légaux sont des modèles à faire valider par un juriste.
