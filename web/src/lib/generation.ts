import { z } from "zod";

/** Clip generation parameters chosen before processing. */
export const DURATION_RANGES = {
  "15-30": { min: 15, max: 30, label: "15 – 30 s" },
  "30-45": { min: 30, max: 45, label: "30 – 45 s" },
  "45-60": { min: 45, max: 60, label: "45 – 60 s" },
  "60-90": { min: 60, max: 90, label: "60 – 90 s" },
} as const;

export const LANGUAGES = {
  auto: "Détection automatique",
  fr: "Français",
  en: "Anglais",
  es: "Espagnol",
  de: "Allemand",
  it: "Italien",
  pt: "Portugais",
  nl: "Néerlandais",
  ar: "Arabe",
} as const;

export const EDIT_STYLES = {
  dynamic: { label: "Dynamique", hint: "Rythme soutenu, sous-titres mot à mot." },
  minimal: { label: "Minimaliste", hint: "Sobre, sous-titres discrets." },
  podcast: { label: "Podcast", hint: "Passages plus longs, cadrage sur le locuteur." },
  gaming: { label: "Gaming", hint: "Réactions, moments forts, texte percutant." },
  educational: { label: "Éducatif", hint: "Explications complètes et autonomes." },
} as const;

export const ASPECTS = ["9:16", "1:1", "16:9"] as const;

export const generationSettingsSchema = z.object({
  duration: z.enum(Object.keys(DURATION_RANGES) as [keyof typeof DURATION_RANGES, ...(keyof typeof DURATION_RANGES)[]]),
  clipCount: z.number().int().min(1).max(20),
  aspect: z.enum(ASPECTS),
  resolution: z.union([z.literal(720), z.literal(1080)]),
  language: z.enum(Object.keys(LANGUAGES) as [keyof typeof LANGUAGES, ...(keyof typeof LANGUAGES)[]]),
  style: z.enum(Object.keys(EDIT_STYLES) as [keyof typeof EDIT_STYLES, ...(keyof typeof EDIT_STYLES)[]]),
  subtitlePreset: z.string().min(1).max(32),
  subtitlesEnabled: z.boolean().default(true),
  smartCrop: z.boolean().default(true),
});

export type GenerationSettings = z.infer<typeof generationSettingsSchema>;

export const DEFAULT_SETTINGS: GenerationSettings = {
  duration: "30-45",
  clipCount: 5,
  aspect: "9:16",
  resolution: 720,
  language: "auto",
  style: "dynamic",
  subtitlePreset: "classic",
  subtitlesEnabled: true,
  smartCrop: true,
};
