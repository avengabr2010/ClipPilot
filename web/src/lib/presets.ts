import type { Entitlements } from "./entitlements";
import { hasFeature } from "./entitlements";
import presetsJson from "./subtitle-presets.json";

/**
 * Subtitle templates. The JSON file is mirrored in the worker
 * (worker/clippilot_worker/subtitle_presets.json); a test enforces that both
 * copies stay identical so preview and render look the same.
 */
export interface SubtitleStyle {
  font: string;
  /** Font size as a fraction of the output height. */
  size: number;
  weight: 400 | 600 | 700 | 800 | 900;
  color: string;
  highlightColor: string;
  outlineColor: string;
  outlineWidth: number;
  background: boolean;
  backgroundColor: string;
  position: "top" | "middle" | "bottom";
  uppercase: boolean;
  animation: "none" | "pop" | "karaoke" | "word";
  wordsPerLine: number;
  highlightKeywords: boolean;
}

export interface SubtitlePreset {
  id: string;
  name: string;
  tier: "free" | "starter" | "creator";
  description: string;
  style: SubtitleStyle;
}

export const SUBTITLE_PRESETS = presetsJson as SubtitlePreset[];

export const FONTS = ["Inter", "Inter Display", "DejaVu Sans", "Liberation Sans", "JetBrains Mono"] as const;

export function getPreset(id: string): SubtitlePreset | undefined {
  return SUBTITLE_PRESETS.find((p) => p.id === id);
}

export function canUsePreset(e: Entitlements, preset: SubtitlePreset): boolean {
  if (preset.tier === "free") return true;
  if (hasFeature(e, "all_templates")) return true;
  return preset.tier === "starter" && hasFeature(e, "custom_subtitles");
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Validates and clamps a user-provided style; falls back to the preset. */
export function sanitizeStyle(input: Partial<SubtitleStyle> | undefined, base: SubtitleStyle): SubtitleStyle {
  const s = { ...base, ...(input ?? {}) };
  return {
    font: (FONTS as readonly string[]).includes(s.font) ? s.font : base.font,
    size: Math.min(0.09, Math.max(0.025, Number(s.size) || base.size)),
    weight: ([400, 600, 700, 800, 900] as const).includes(s.weight) ? s.weight : base.weight,
    color: HEX.test(s.color) ? s.color : base.color,
    highlightColor: HEX.test(s.highlightColor) ? s.highlightColor : base.highlightColor,
    outlineColor: HEX.test(s.outlineColor) ? s.outlineColor : base.outlineColor,
    outlineWidth: Math.min(8, Math.max(0, Number(s.outlineWidth) || 0)),
    background: Boolean(s.background),
    backgroundColor: HEX.test(s.backgroundColor) ? s.backgroundColor : base.backgroundColor,
    position: (["top", "middle", "bottom"] as const).includes(s.position) ? s.position : base.position,
    uppercase: Boolean(s.uppercase),
    animation: (["none", "pop", "karaoke", "word"] as const).includes(s.animation) ? s.animation : base.animation,
    wordsPerLine: Math.min(8, Math.max(1, Math.round(Number(s.wordsPerLine) || base.wordsPerLine))),
    highlightKeywords: Boolean(s.highlightKeywords),
  };
}
