import { Captions, Crop, Gauge, LayoutTemplate, Magnet, MonitorSmartphone, Scissors, ShieldCheck, Sparkles, Wand2 } from "lucide-react";

export const FEATURES = [
  { icon: Sparkles, title: "Détection des meilleurs moments", text: "Transcription mot à mot puis analyse de chaque passage : accroche, cohérence, intérêt, rythme, audio." },
  { icon: Scissors, title: "Découpe propre", text: "Les clips commencent et finissent sur des phrases complètes. Pas de phrase coupée, pas de fin abrupte." },
  { icon: Captions, title: "Sous-titres animés", text: "Synchronisés à la voix, mot actif mis en évidence, modèles professionnels et style entièrement personnalisable." },
  { icon: Crop, title: "Recadrage intelligent", text: "Détection des visages et suivi du locuteur pour un cadrage vertical stable, avec correction manuelle." },
  { icon: Magnet, title: "Hook Detector", text: "Repère les débuts accrocheurs : question, anecdote, chiffre marquant, affirmation surprenante." },
  { icon: Gauge, title: "Virality Score", text: "Un score indicatif et expliqué pour prioriser vos clips — jamais présenté comme une garantie." },
  { icon: Wand2, title: "Éditeur simple", text: "Ajustez début et fin, corrigez le texte, changez de format ou de modèle, réexportez en un clic." },
  { icon: LayoutTemplate, title: "Trois formats", text: "9:16 pour TikTok, Reels et Shorts, 1:1 pour le feed, 16:9 pour YouTube. En 720p ou 1080p." },
  { icon: MonitorSmartphone, title: "Mobile et ordinateur", text: "Importez depuis votre galerie, éditez sur téléphone, installez ClipPilot sur votre écran d'accueil." },
  { icon: ShieldCheck, title: "Vos données protégées", text: "Fichiers privés, liens temporaires, suppression automatique et isolation stricte des comptes." },
] as const;
