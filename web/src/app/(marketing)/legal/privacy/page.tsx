import type { Metadata } from "next";
export const metadata: Metadata = { title: "Politique de confidentialité" };

export default function PrivacyPage() {
  return (
    <>
      <h1>Politique de confidentialité</h1>
      <p className="text-sm">Dernière mise à jour : 31 octobre 2026. Modèle à faire valider par un conseil juridique avant commercialisation.</p>
      <h2>Données collectées</h2>
      <ul>
        <li>Compte : adresse e-mail, nom (facultatif), mot de passe (stocké uniquement sous forme hachée par Supabase Auth).</li>
        <li>Contenus : vidéos importées, transcriptions, clips générés et réglages d'édition.</li>
        <li>Usage : minutes consommées, clips exportés, journaux techniques nécessaires au fonctionnement et à la sécurité.</li>
        <li>Paiement : géré par Stripe. Nous ne stockons jamais vos coordonnées bancaires.</li>
      </ul>
      <h2>Finalités</h2>
      <p>Fournir le service (transcription, analyse, montage, export), gérer votre abonnement et vos quotas, assurer la sécurité et prévenir les abus.</p>
      <h2>Traitement des vidéos</h2>
      <p>La transcription et l'analyse sont réalisées sur nos serveurs avec des modèles open source. Si une analyse complémentaire par un fournisseur d'IA est activée, seule la transcription textuelle des passages candidats lui est transmise, jamais la vidéo.</p>
      <h2>Conservation</h2>
      <p>Vidéos sources : 7 jours. Exports : 30 jours (valeurs par défaut). Données de compte : jusqu'à la suppression du compte.</p>
      <h2>Sécurité</h2>
      <p>Fichiers stockés dans des espaces privés, accessibles uniquement via des liens temporaires signés. Isolation stricte des données entre comptes au niveau de la base de données.</p>
      <h2>Vos droits</h2>
      <p>Conformément au RGPD, vous disposez d'un droit d'accès, de rectification, d'effacement et de portabilité. La suppression du compte depuis les paramètres efface immédiatement l'ensemble de vos données.</p>
      <h2>Sous-traitants</h2>
      <ul>
        <li>Supabase (base de données, authentification, stockage)</li>
        <li>Vercel (hébergement de l'application web)</li>
        <li>Stripe (paiements), lorsque les abonnements sont activés</li>
      </ul>
    </>
  );
}
