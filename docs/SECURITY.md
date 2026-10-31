# Sécurité

## Principes

1. **La base de données est la dernière ligne de défense.** Toute table a la RLS activée ; les clients (`anon`, `authenticated`) n'ont que les privilèges explicitement accordés, colonne par colonne quand c'est nécessaire.
2. **Le serveur web ne fait jamais confiance au client** : chaque entrée est validée (zod), chaque action vérifie la session (`auth.getUser()`, validée par le serveur Auth) et les droits (`get_entitlements`).
3. **Les secrets ne quittent jamais le serveur** : `SUPABASE_SERVICE_ROLE_KEY`, clés Stripe et LLM sont lus via `lib/env.ts` (import `server-only` → erreur de build s'il est importé côté client). Seules les variables `NEXT_PUBLIC_*` (URL + clé anon) sont publiques.
4. **Mots de passe** : gérés exclusivement par Supabase Auth (bcrypt). Politique : 10 caractères min., lettre + chiffre. Aucune réponse ne révèle si un e-mail existe (reset).

## Rôle OWNER

| Menace | Protection |
| --- | --- |
| Un utilisateur s'attribue OWNER/ADMIN | `user_roles` n'a **aucun** privilège d'écriture pour `authenticated` ; `admin_set_role` refuse `OWNER` et n'est utilisable que par l'OWNER |
| Écriture directe en base (bug, script) | Trigger `guard_owner_role` : toute création/modification/suppression d'un rôle OWNER échoue sauf dans la transaction de `bootstrap_owner` / vérification e-mail (drapeau transactionnel) |
| Usurpation de l'e-mail propriétaire avant inscription | OWNER n'est attribué qu'**après vérification de l'e-mail** (`email_confirmed_at`) |
| Changement d'`OWNER_EMAIL` | `owner:init` rétrograde l'ancien OWNER ; il n'y a jamais plus d'un OWNER |
| Ligne OWNER altérée en base | Le serveur web recoupe avec `OWNER_EMAIL` (`resolveEffectiveRole`) : sans correspondance, le compte est traité comme USER et perd l'illimité |
| Suppression accidentelle | Le compte OWNER ne peut pas être supprimé depuis l'application |

## Crédits et abonnements

- `credit_balances`, `credit_transactions`, `subscriptions`, `plans` : **lecture seule** pour les clients.
- Les débits passent par des fonctions `SECURITY DEFINER` exécutables uniquement par `service_role` (`consume_minutes`, `consume_clip`, `refund_minutes`), avec verrou de ligne (`FOR UPDATE`) et **idempotence** (index unique par vidéo/clip) : pas de double débit, pas de course.
- Le quota est vérifié deux fois : à la création (durée déclarée) et dans le worker avec la **durée réelle mesurée par ffprobe**.
- Les abonnements ne sont modifiés que par le webhook Stripe (signature vérifiée, événements dédupliqués) ou par un admin (journalisé).
- Les crédits offerts par un admin sont journalisés ; un ADMIN ne peut pas s'en offrir.

## Fichiers

- Buckets **privés** ; accès en lecture uniquement par URL signée à durée limitée (`SIGNED_URL_TTL_SECONDS`), générée après contrôle de propriété.
- Upload : chemin réservé par le serveur, politique storage qui n'autorise que ce chemin, pour cet utilisateur, tant que la vidéo est `uploading` → pas d'écrasement, pas d'upload arbitraire, pas de traversée de chemin.
- Types MIME restreints au niveau du bucket ; extension + type contrôlés côté serveur ; **contenu réel vérifié par ffprobe** (conteneur, codec vidéo autorisé, dimensions ≤ 4K, durée) : un fichier non conforme est supprimé immédiatement.
- FFmpeg tourne dans le worker, isolé du web, en utilisateur non privilégié (Dockerfile), avec timeouts.
- Suppression : projets, vidéos, clips et compte suppriment aussi les objets de stockage ; expiration automatique des sources et exports.
- Sous-titres : le texte saisi est échappé avant injection dans le fichier ASS (pas d'injection de balises).

## API

- Rate limiting partagé en base (`rate_limit_hit`) : imports, rendus, relances, téléchargements, connexion/inscription/reset par IP.
- Vérification de l'origine pour toute requête mutante (en plus des cookies `SameSite=Lax`).
- Les ressources d'autrui renvoient `404` (pas de fuite d'existence).
- En-têtes : CSP stricte, `X-Frame-Options: DENY`, `nosniff`, HSTS, `Referrer-Policy`, `Permissions-Policy`.
- Redirections post-connexion limitées aux chemins internes (`/…`, jamais `//…`).

## Isolation des données

Chaque table utilisateur filtre sur `user_id = auth.uid()` ; les admins ont une lecture étendue via `is_admin()`. Les tests `web/tests/db/security.test.ts` vérifient : isolation entre comptes, interdiction de modifier crédits/abonnements/rôles, garde OWNER, quotas, politique d'upload, file de jobs.

## Données envoyées à des tiers

- Aucune par défaut (transcription et analyse locales).
- Si `ANTHROPIC_API_KEY` est configurée : uniquement le **texte** des passages candidats (jamais la vidéo ni l'audio).
- Stripe : e-mail et identifiant utilisateur pour la facturation.

## Signaler une vulnérabilité

Écrire au propriétaire du service (adresse de contact du site). Merci de ne pas divulguer publiquement avant correction.
