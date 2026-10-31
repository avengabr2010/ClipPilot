# API

Toutes les routes sont sous `web/src/app/api`. Authentification par cookie de session Supabase (posé par `/login`). Les requêtes non-GET doivent provenir de la même origine (vérification `Origin`). Réponses d'erreur :

```json
{ "error": { "code": "quota_exceeded", "message": "Message lisible en français." } }
```

Codes : `400` validation · `401` non connecté · `402` quota · `403` interdit/fonction non incluse · `404` introuvable (aussi pour les ressources d'autrui) · `409` état invalide · `410` expiré · `429` rate limit · `503` service désactivé.

## Vidéos & jobs

| Méthode | Route | Description |
| --- | --- | --- |
| POST | `/api/videos` | Prépare un import. Corps : `{ filename, size, type, durationSeconds, projectId?, projectName?, settings }`. Retour `201 { videoId, projectId, bucket, path, mime, settings }`. Limite 30/h |
| POST | `/api/videos/:id/complete` | Confirme l'upload (vérifie l'objet) et crée le job `process_video`. Retour `{ jobId }` |
| DELETE | `/api/videos/:id` | Supprime la vidéo, ses clips, exports et fichiers |
| POST | `/api/jobs/:id/cancel` | Annule un job en attente/en cours (remboursement des minutes) |
| POST | `/api/jobs/:id/retry` | Relance un job échoué/annulé. Limite 10/10 min |

`settings` :

```json
{ "duration": "15-30|30-45|45-60|60-90", "clipCount": 1-20, "aspect": "9:16|1:1|16:9",
  "resolution": 720|1080, "language": "auto|fr|en|es|de|it|pt|nl|ar",
  "style": "dynamic|minimal|podcast|gaming|educational", "subtitlePreset": "classic|bold|minimal|karaoke|podcast|gaming|editorial",
  "subtitlesEnabled": true, "smartCrop": true }
```

## Projets & clips

| Méthode | Route | Description |
| --- | --- | --- |
| PATCH | `/api/projects/:id` | Renommer `{ name }` |
| DELETE | `/api/projects/:id` | Supprimer le projet et tout son contenu |
| PATCH | `/api/clips/:id` | Renommer `{ title }` |
| DELETE | `/api/clips/:id` | Supprimer le clip et ses fichiers |
| PUT | `/api/clips/:id/edit` | Enregistrer l'édition : `{ start, end, aspect, resolution, template, subtitlesEnabled, style?, words?, crop: { mode: auto|manual|center, x?, zoom? } }` — validé et filtré selon l'offre |
| POST | `/api/clips/:id/render` | Lance un réexport (`render_clip`). Limite 20/10 min |
| GET | `/api/clips/:id/download` | `302` vers une URL signée du MP4 courant (nom de fichier = titre) |
| GET | `/api/clips/:id/media` | `{ sourceUrl, exportUrl }` signées (éditeur) |

## Compte & facturation

| Méthode | Route | Description |
| --- | --- | --- |
| PATCH | `/api/account/profile` | `{ fullName?, onboardingCompleted? }` |
| POST | `/api/account/delete` | `{ confirm: "SUPPRIMER" }` — supprime fichiers, abonnement Stripe et compte |
| POST | `/api/billing/checkout` | `{ planId: "starter"|"creator" }` → `{ url }` Stripe Checkout (`503` si facturation fermée) |
| POST | `/api/billing/portal` | → `{ url }` portail client Stripe |
| POST | `/api/stripe/webhook` | Webhook Stripe signé, idempotent |
| GET | `/api/health` | Sonde de disponibilité |

Authentification (server actions) : `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/check-email` ; liens e-mail : `GET /auth/confirm` ; déconnexion : `POST /auth/signout`.

## Administration (OWNER/ADMIN)

| Méthode | Route | Description |
| --- | --- | --- |
| POST | `/api/admin/users/:id/role` | `{ role: "ADMIN"|"USER" }` — OWNER uniquement |
| POST | `/api/admin/users/:id/credits` | `{ minutes, clips, note }` — crédits bonus de la période |
| POST | `/api/admin/users/:id/plan` | `{ planId }` — attribution manuelle |
| PUT | `/api/admin/plans/:id` | Modifier une offre (prix, limites, fonctionnalités, `stripe_price_id`) |
| PUT | `/api/admin/flags/:key` | `{ enabled }` — `billing` refusé si Stripe non configuré |
| POST | `/api/admin/jobs/:id/retry` | Relancer le job d'un utilisateur |

## Fonctions SQL (RPC)

| Fonction | Appelable par | Rôle |
| --- | --- | --- |
| `get_entitlements(p_user)` | utilisateur (soi), admin, service | Droits, limites, consommation, fonctionnalités |
| `admin_set_role`, `admin_grant_credits`, `admin_set_plan`, `admin_stats` | utilisateur authentifié (autorisation vérifiée dans la fonction) | Administration journalisée |
| `bootstrap_owner(p_email)` | service | Initialisation du propriétaire |
| `consume_minutes`, `refund_minutes`, `consume_clip`, `ensure_credit_period` | service | Crédits (atomiques, idempotents) |
| `claim_next_job`, `job_heartbeat`, `complete_job`, `fail_job`, `requeue_stale_jobs` | service | File de jobs |
| `rate_limit_hit(key, window, max)` | service | Rate limiting partagé |
