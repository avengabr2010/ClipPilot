import type { Metadata } from "next";
export const metadata: Metadata = { title: "Conditions d'utilisation" };

export default function TermsPage() {
  return (
    <>
      <h1>Conditions d'utilisation</h1>
      <p className="text-sm">Dernière mise à jour : 31 octobre 2026. Modèle à faire valider par un conseil juridique avant commercialisation.</p>
      <h2>1. Objet</h2>
      <p>ClipPilot est un service en ligne qui transforme des vidéos fournies par l'utilisateur en clips courts sous-titrés. Les présentes conditions régissent l'utilisation du service.</p>
      <h2>2. Compte</h2>
      <p>Vous devez fournir une adresse e-mail valide et garder vos identifiants confidentiels. Vous êtes responsable de l'activité de votre compte.</p>
      <h2>3. Contenus importés</h2>
      <ul>
        <li>Vous n'importez que des vidéos dont vous détenez les droits ou que vous êtes autorisé à utiliser.</li>
        <li>Vous restez propriétaire de vos contenus. Vous nous accordez uniquement le droit de les traiter pour fournir le service.</li>
        <li>Les contenus illicites, haineux ou portant atteinte aux droits de tiers sont interdits et peuvent entraîner la suspension du compte.</li>
      </ul>
      <h2>4. Offres, quotas et paiement</h2>
      <p>Chaque offre inclut un volume mensuel de minutes de vidéo source et de clips exportables. Les quotas non utilisés ne sont pas reportés. Les abonnements payants sont gérés par Stripe, renouvelés automatiquement et résiliables à tout moment ; la résiliation prend effet à la fin de la période en cours.</p>
      <h2>5. Scores et analyses</h2>
      <p>Le Virality Score et le Hook Detector sont des indicateurs fournis à titre informatif. Ils ne constituent en aucun cas une garantie de performance ou d'audience.</p>
      <h2>6. Conservation des fichiers</h2>
      <p>Les vidéos sources et les exports sont supprimés automatiquement après la durée de conservation indiquée dans l'application. Il vous appartient de télécharger vos clips.</p>
      <h2>7. Disponibilité et responsabilité</h2>
      <p>Nous faisons nos meilleurs efforts pour assurer la disponibilité du service, sans garantie d'absence d'interruption. Notre responsabilité est limitée au montant payé au cours des douze derniers mois.</p>
      <h2>8. Résiliation</h2>
      <p>Vous pouvez supprimer votre compte à tout moment depuis les paramètres. Toutes vos données et fichiers sont alors définitivement supprimés.</p>
      <h2>9. Droit applicable</h2>
      <p>Les présentes conditions sont régies par le droit français.</p>
    </>
  );
}
