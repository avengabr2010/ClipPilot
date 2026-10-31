# Architecture

```
                ┌──────────────────────────── Navigateur / PWA ─────────────────────────────┐
                │ Next.js (React 19) · Tailwind · Radix · TUS upload direct → Supabase Storage│
                └───────────────┬──────────────────────────────┬────────────────────────────┘
                                │ HTTPS (cookies de session)   │ TUS (JWT utilisateur, RLS storage)
                ┌───────────────▼───────────────┐   ┌──────────▼───────────┐
                │ Next.js serveur (Vercel)      │   │ Supabase             │
                │ · pages RSC (lecture sous RLS)│   │ · Postgres + RLS     │
                │ · routes API (validation zod, │◄──┤ · Auth (GoTrue)      │
                │   quotas, rate limit, Stripe) │   │ · Storage (privé)    │
                └───────────────┬───────────────┘   └──────────▲───────────┘
                                │ INSERT video_jobs            │ claim_next_job (SKIP LOCKED),
                                ▼                              │ heartbeat, download/upload
                        ┌───────────────────────────────────────┴──────────────┐
                        │ Workers Python (N conteneurs, scalables)             │
                        │ ffprobe → FFmpeg audio → faster-whisper → analyse →  │
                        │ OpenCV recadrage → FFmpeg rendu + ASS → validation   │
                        └──────────────────────────────────────────────────────┘
```

## Choix techniques

| Décision | Raison |
| --- | --- |
| **Next.js 15 App Router** | Pages serveur rapides (lecture directe sous RLS), routes API dans le même déploiement Vercel, PWA |
| **Supabase** (Postgres, Auth, Storage) | Auth complète (vérif. e-mail, reset, PKCE), RLS = isolation au niveau base, stockage avec upload résumable TUS |
| **File de jobs dans Postgres** | Pas de service supplémentaire (Redis…) : `FOR UPDATE SKIP LOCKED` donne une file fiable et transactionnelle. Remplaçable par une file dédiée si le volume l'exige |
| **Workers Python séparés** | Le traitement vidéo ne bloque jamais le serveur web ; écosystème FFmpeg/Whisper/OpenCV natif ; mise à l'échelle horizontale |
| **faster-whisper local** | Open source, gratuit, horodatage au mot, fonctionne hors ligne ; pas de dépendance à une API payante |
| **Analyse heuristique explicable + LLM optionnel** | Fonctionne sans clé API, coût nul, résultats justifiables ; un LLM peut affiner titres/classement si configuré |
| **ASS + libass** pour les sous-titres | Rendu professionnel (contour, fond, karaoké, animations) en une passe FFmpeg ; Remotion n'apporte rien ici et ajouterait un rendu Chrome coûteux |
| **Upload direct navigateur → Storage** | Le serveur web ne relaie jamais les gros fichiers ; reprise après coupure |

Fournisseurs découplés : Vercel (web), Supabase (données), hébergeur au choix pour les workers (Fly.io, Railway, Hetzner, serveur GPU…), Stripe (paiement) — chacun remplaçable.

## Flux d'import et de traitement

1. **`POST /api/videos`** : valide nom/type/taille/durée déclarée contre les droits (`get_entitlements`), vérifie quotas, modèle, résolution ; crée projet + vidéo `uploading` et réserve `sources/{user}/{video}/source.ext`.
2. **Upload TUS** direct vers Storage avec le JWT de l'utilisateur. La politique storage n'accepte **que** ce chemin exact, pour une vidéo de cet utilisateur encore en `uploading`.
3. **`POST /api/videos/:id/complete`** : vérifie que l'objet existe avec la bonne taille, passe la vidéo en `uploaded`, insère un job `process_video` avec la priorité de l'offre.
4. **Worker** (`claim_next_job`) :
   - télécharge, `ffprobe` (conteneur, codec, durée, résolution réelles) → rejet + suppression si invalide ;
   - **débit des minutes** (`consume_minutes`, atomique, idempotent par vidéo) ;
   - extraction audio 16 kHz → transcription mot à mot → `transcripts` ;
   - analyse : phrases → fenêtres candidates bornées → score multicritère → sélection gloutonne sans chevauchement (>15 %) ni redondance lexicale (Jaccard > 0,55) ;
   - pour chaque clip : trajectoire de recadrage → ASS → rendu FFmpeg → **validation** (durée ±3 %, dimensions, taille) → upload → `consume_clip` → `exports` ; le clip ne passe `ready` qu'après ces étapes ;
   - vidéo `ready` + date d'expiration de la source.
5. Le navigateur suit la progression (`video_jobs.progress/stage`, lecture sous RLS) et rafraîchit la page à la fin.

Échecs : erreur utilisateur (fichier, quota) → pas de retry, minutes remboursées ; erreur technique → retry exponentiel (30 s, 60 s, …) jusqu'à `max_attempts`, puis échec + remboursement. Un clip qui échoue n'empêche pas les autres.

## Moteur d'analyse (`worker/clippilot_worker/analysis.py`)

| Critère | Signal |
| --- | --- |
| Accroche (Hook) | motifs FR/EN : question, surprise, anecdote, affirmation forte, curiosité, statistique ; pénalité si noyée dans une phrase longue |
| Cohérence | fin sur ponctuation terminale, pas de début par un connecteur (« et », « donc », « but »…) |
| Autonomie | pas de pronom sans antécédent en ouverture |
| Intérêt | mots du sujet principal (fréquence dans toute la vidéo), diversité lexicale, émotion, explications, adresse directe |
| Rythme | mots/s proche de 2,9, peu de longues pauses, peu d'hésitations |
| Audio | niveau RMS du passage vs médiane de la vidéo, énergie (gaming) |
| Longueur | proximité du centre de la plage demandée |

Les pondérations dépendent du style (dynamique, minimaliste, podcast, gaming, éducatif). Le Virality Score est une sigmoïde du score total, borné 5–98, accompagné de son détail.

## Recadrage (`reframe.py`)

Échantillonnage ~3 i/s → détection de visages (Haar, CPU) → si plusieurs visages, préférence au plus grand et à celui dont la zone de la bouche bouge le plus, avec hystérésis → médiane glissante → zone morte + maintien minimal 1,2 s → images clés → expression FFmpeg `crop` avec transitions *smoothstep* de 0,5 s. L'éditeur rejoue la même trajectoire pour l'aperçu.

## File de jobs

`video_jobs` : `queued → running → succeeded | failed | cancelled`. Champs : `priority`, `attempts/max_attempts`, `run_after` (backoff), `locked_by`, `heartbeat_at`, `progress`, `stage`.

- `claim_next_job` : priorité puis ancienneté, **un seul job lourd par utilisateur à la fois** (équité).
- Heartbeat toutes les 10 s ; s'il renvoie `false` (annulation), le worker tue FFmpeg et s'arrête.
- `requeue_stale_jobs` (toutes les 10 min) récupère les jobs d'un worker mort.
- Timeout par job (`JOB_TIMEOUT_SECONDS`) et par processus FFmpeg.
- Concurrence par worker : `WORKER_CONCURRENCY` ; montée en charge : plus de conteneurs, et/ou workers spécialisés via `WORKER_JOB_TYPES` (ex. GPU pour `process_video`, CPU pour `render_clip`).

## Nettoyage

Le worker exécute `cleanup` toutes les 10 min : suppression des sources expirées (vidéo → `expired`, les clips restent), des exports expirés, des uploads abandonnés (> 24 h en `uploading`), et requeue des jobs bloqués. Les fichiers temporaires de chaque job sont supprimés en fin de job (succès ou échec).

## Données

Voir `supabase/migrations`. Tables : `profiles`, `user_roles`, `plans`, `subscriptions`, `credit_balances`, `credit_transactions`, `projects`, `videos`, `video_jobs`, `transcripts`, `clips`, `clip_edits`, `exports`, `usage_logs`, `admin_logs`, `feature_flags`, `rate_limits`, `stripe_events`, `app_config`.

Sauvegardes : Supabase Cloud fournit des sauvegardes quotidiennes (PITR sur les offres payantes). Les vidéos sources sont volontairement éphémères ; les exports sont conservés 30 jours.

## Frontend

- Mobile-first : barre d'onglets inférieure + bouton central « Créer » sur mobile, sidebar sur ordinateur ; dialogues en *bottom sheet* sur mobile ; cibles tactiles ≥ 44 px.
- Thème clair/sombre (`next-themes`, tokens HSL).
- PWA : `manifest.webmanifest`, icônes, service worker (cache du shell statique uniquement, jamais des API/médias), page hors ligne.
- L'aperçu de l'éditeur lit la source via URL signée : le navigateur doit décoder le codec source (H.264 : tous les navigateurs grand public).
