# Installation

## Prérequis

| Outil | Version | Usage |
| --- | --- | --- |
| Node.js | 20+ (22 recommandé) | application web |
| Python | 3.11+ | worker vidéo |
| FFmpeg / FFprobe | 5+ avec `libass` et `libx264` | découpe, sous-titres, encodage |
| Docker | récent | Supabase local (`supabase start`) |
| Supabase CLI | 2.x (`npx supabase`) | base locale, migrations |

### Installer FFmpeg

- **macOS** : `brew install ffmpeg`
- **Ubuntu/Debian** : `sudo apt install ffmpeg`
- **Windows** : `winget install Gyan.FFmpeg` (ou binaire de gyan.dev), puis ajouter `bin/` au `PATH`.

Vérifier : `ffmpeg -filters | grep -E " ass |subtitles"` doit lister le filtre `ass`.

## 1. Supabase (base, auth, stockage)

```bash
npx supabase start
```

La commande applique automatiquement `supabase/migrations/*` (schéma, fonctions, RLS, buckets `sources` et `exports`, offres et feature flags) et affiche :

- `API URL` → `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL`
- `anon key` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role key` → `SUPABASE_SERVICE_ROLE_KEY` (**serveur uniquement**)
- `Mailpit URL` (http://127.0.0.1:54324) : boîte mail locale où arrivent les e-mails de confirmation.

`supabase/config.toml` active la confirmation d'e-mail, la taille d'upload (4 Gio) et les URLs de redirection locales.

### Modèles d'e-mail (production)

Dans Supabase Cloud → Authentication → URL Configuration :

- **Site URL** : `https://votre-domaine`
- **Redirect URLs** : `https://votre-domaine/**`

Les liens des e-mails (confirmation, réinitialisation) aboutissent sur `/auth/confirm`, qui gère à la fois `token_hash` et le flux PKCE (`code`).

## 2. Application web

```bash
cd web
cp ../.env.example .env.local   # remplir les valeurs Supabase + OWNER_EMAIL
npm install
npm run dev                      # http://localhost:3000
```

Commandes utiles : `npm run build`, `npm run start`, `npm run typecheck`, `npm test`.

## 3. Compte propriétaire (OWNER)

1. Définir `OWNER_EMAIL=vous@domaine.com` dans `web/.env.local` (et dans les variables Vercel en production).
2. Exécuter **une fois** (et après chaque changement d'`OWNER_EMAIL`) :
   ```bash
   cd web && npm run owner:init
   ```
   Le script appelle la fonction SQL `bootstrap_owner` avec la clé service : il enregistre l'e-mail côté serveur, promeut ce compte s'il existe et est vérifié, et rétrograde tout autre OWNER.
3. Créer le compte avec cette adresse sur `/signup` (ou l'avoir déjà créé) et **confirmer l'e-mail** : le rôle OWNER est attribué automatiquement à la vérification.

Le propriétaire obtient : premium intégral, crédits illimités, tous les modèles, 1080p sans filigrane, priorité maximale, fonctionnalités expérimentales, accès admin et l'espace « Configuration → Espace de test Premium ».

> La gratuité concerne les droits internes de ClipPilot. Les services externes (hébergement, Stripe, API LLM éventuelle) restent facturés par leurs fournisseurs.

## 4. Worker vidéo

```bash
cd worker
python -m venv .venv
.venv/bin/pip install -r requirements.txt       # Windows : .venv\Scripts\pip
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SERVICE_ROLE_KEY=...            # même valeur que le web
.venv/bin/python -m clippilot_worker.main
```

Options : `--once` (traite au plus une tâche), `--cleanup` (lance uniquement le nettoyage).

### Whisper

ClipPilot utilise **faster-whisper** (open source, local, sans coût d'API). Le modèle est téléchargé depuis Hugging Face au premier lancement et mis en cache (`WHISPER_MODEL_DIR`).

| `WHISPER_MODEL` | Qualité | Vitesse CPU (ordre de grandeur) |
| --- | --- | --- |
| `tiny` / `base` | correcte | très rapide |
| `small` (défaut) | bonne | ~0,3–0,5× temps réel sur 4 vCPU |
| `medium` / `large-v3` | excellente | GPU recommandé (`WHISPER_DEVICE=cuda`, `WHISPER_COMPUTE_TYPE=float16`) |

Pour un serveur sans accès Internet, pré-téléchargez le modèle (`WhisperModel("small", download_root="/models")`) — c'est ce que fait le `Dockerfile` du worker.

### LLM (optionnel)

Si `ANTHROPIC_API_KEY` est défini et le flag `llm_analysis` actif, les titres et le classement sont affinés par un LLM (seul le texte des passages candidats est envoyé). Sans clé, le moteur local fonctionne seul — aucune fonctionnalité n'est simulée.

## 5. Stripe (optionnel)

Les offres payantes restent **fermées** tant que ces variables ne sont pas toutes définies **et** que le flag `billing` n'est pas activé dans l'admin :

```
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...     # prix mensuel récurrent 5,99 €
STRIPE_PRICE_CREATOR=price_...     # prix mensuel récurrent 11,99 €
```

Webhook (événements `checkout.session.completed`, `customer.subscription.*`, `invoice.paid`) vers `https://votre-domaine/api/stripe/webhook`. En local : `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

Activez le portail client Stripe (changement d'offre, annulation, factures, moyen de paiement).

## 6. Tests

```bash
# Postgres local "nu" + stubs Supabase (rapide, sans Docker)
bash scripts/db-test-setup.sh          # PGHOST/PGPASSWORD configurables
cd web && npm test
cd worker && .venv/bin/pip install -r requirements-dev.txt && .venv/bin/python -m pytest

# Navigateur (nécessite la pile complète lancée)
cd web && VIDEO=/chemin/video.mp4 node tests/e2e/full-flow.mjs
cd web && node tests/e2e/responsive.mjs
```
