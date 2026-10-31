# Déploiement

Cible recommandée (économique, chaque brique remplaçable) :

| Composant | Service | Coût de départ |
| --- | --- | --- |
| Web + API | Vercel (Hobby/Pro) | 0–20 $/mois |
| Base, Auth, Storage | Supabase Cloud | 0 $ (Free) → 25 $/mois (Pro, recommandé en production : sauvegardes, 100 Go) |
| Workers vidéo | Conteneur Docker : Fly.io, Railway, Render, Hetzner/OVH VPS, ou serveur GPU | ~5–40 $/mois selon CPU |
| Paiement | Stripe | commission par transaction |

## 1. Supabase Cloud

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push            # applique supabase/migrations
```

Puis dans le dashboard :

- **Auth → URL configuration** : Site URL `https://votre-domaine`, Redirect URLs `https://votre-domaine/**`.
- **Auth → Email** : activer « Confirm email ». Configurer un SMTP (Resend, Postmark, Brevo…) pour la production.
- **Auth → Rate limits** : garder les valeurs par défaut ou plus strictes.
- **Storage → Settings** : limite globale de taille ≥ la plus grande limite d'offre (4 Go par défaut).
- **Database → Backups** : activer PITR (offre Pro).

## 2. Vercel (web)

1. Importer le dépôt, **Root Directory = `web`**.
2. Variables d'environnement (Production) : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `OWNER_EMAIL`, et si besoin `STRIPE_*`, `SIGNED_URL_TTL_SECONDS`, `COST_PER_*`.
3. Déployer. Vérifier `https://votre-domaine/api/health`.
4. Initialiser le propriétaire depuis votre poste :
   ```bash
   cd web
   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OWNER_EMAIL=... npm run owner:init
   ```
   puis créer/vérifier le compte avec cet e-mail.

## 3. Workers

Image : `worker/Dockerfile` (FFmpeg, faster-whisper avec le modèle pré-téléchargé, OpenCV, utilisateur non root).

```bash
cd worker
docker build -t clippilot-worker --build-arg WHISPER_MODEL=small .
docker run -d --restart unless-stopped \
  -e SUPABASE_URL=https://<ref>.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  -e WORKER_CONCURRENCY=1 \
  clippilot-worker
```

Exemple Fly.io : `fly launch --no-deploy` dans `worker/`, `fly secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...`, machine `performance-2x` (2 vCPU, 4 Go) minimum pour `small`.

### Dimensionnement

- 1 worker `small` sur 4 vCPU traite environ 2–3 h de vidéo source par heure (transcription dominante) ; le rendu d'un clip 1080p de 45 s prend ~10–20 s.
- Plus d'utilisateurs → plus de conteneurs (aucune configuration : `SKIP LOCKED`).
- Séparer les charges : `WORKER_JOB_TYPES=process_video` sur des machines GPU (`WHISPER_DEVICE=cuda`, `WHISPER_COMPUTE_TYPE=float16`, `WHISPER_MODEL=large-v3`), `WORKER_JOB_TYPES=render_clip` sur des machines CPU.
- Prévoir du disque temporaire : ~2× la taille de la plus grande vidéo par job concurrent.

### Arrêt propre

`SIGTERM` : le worker cesse de prendre des jobs et termine les jobs en cours. Un worker tué brutalement est détecté (heartbeat > 5 min) et son job est remis en file.

## 4. Stripe

1. Créer deux produits avec un prix mensuel récurrent : Starter 5,99 €, Creator 11,99 €.
2. Renseigner `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_CREATOR` (ou le champ « Stripe price ID » de chaque offre dans `/admin/plans`).
3. Webhook → `https://votre-domaine/api/stripe/webhook`, événements : `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`. Copier le secret dans `STRIPE_WEBHOOK_SECRET`.
4. Activer le **portail client** (changement d'offre avec prorata, annulation en fin de période, factures, moyen de paiement).
5. Vérifier les obligations commerciales (CGV, mentions légales, TVA/OSS) puis activer le flag **`billing`** dans `/admin/config`. Tant que le flag est désactivé, les offres payantes affichent « Bientôt disponible » et l'API de paiement répond `503`.

## 5. Checklist de mise en production

- [ ] Migrations appliquées, confirmation e-mail activée, SMTP configuré
- [ ] Variables Vercel renseignées, `NEXT_PUBLIC_SITE_URL` = domaine final
- [ ] `owner:init` exécuté, compte propriétaire vérifié (badge « Propriétaire » visible)
- [ ] Au moins un worker en ligne (Admin → Configuration → Workers vidéo)
- [ ] Test complet : import → clips → édition → export → téléchargement
- [ ] Sauvegardes Supabase activées
- [ ] Textes légaux validés par un juriste
- [ ] Stripe (facultatif) : produits, webhook, portail, flag `billing`
