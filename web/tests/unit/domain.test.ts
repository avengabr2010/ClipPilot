import { describe, expect, it } from "vitest";
import { canAssignRole, resolveEffectiveRole } from "@/lib/permissions";
import { canProcessMinutes, clampClipCount, hasFeature, type Entitlements } from "@/lib/entitlements";
import { resolveMime, safeFilename, validateUpload } from "@/lib/upload";
import { canUsePreset, getPreset, sanitizeStyle, SUBTITLE_PRESETS } from "@/lib/presets";
import { DEFAULT_SETTINGS, generationSettingsSchema } from "@/lib/generation";
import { formatDuration } from "@/lib/format";

const free: Entitlements = {
  user_id: "u", role: "USER", unlimited: false, admin: false, plan: { id: "free", name: "Free" },
  subscription_status: "active", cancel_at_period_end: false, period_start: "", period_end: "",
  minutes_limit: 30, minutes_used: 10, minutes_remaining: 20, clips_limit: 3, clips_used: 1, clips_remaining: 2,
  max_resolution: 720, max_upload_mb: 500, max_video_minutes: 30, watermark: true, priority: 0,
  features: { custom_subtitles: false, smart_crop: false },
};
const owner: Entitlements = { ...free, role: "OWNER", unlimited: true, admin: true, minutes_remaining: null, clips_remaining: null };
const starter: Entitlements = { ...free, plan: { id: "starter", name: "Starter" }, features: { custom_subtitles: true, smart_crop: true } };

describe("OWNER resolution", () => {
  it("honours OWNER only with matching verified email", () => {
    expect(resolveEffectiveRole({ dbRole: "OWNER", email: "Me@x.com", emailConfirmed: true, ownerEmail: "me@x.com" })).toBe("OWNER");
    expect(resolveEffectiveRole({ dbRole: "OWNER", email: "me@x.com", emailConfirmed: false, ownerEmail: "me@x.com" })).toBe("USER");
    expect(resolveEffectiveRole({ dbRole: "OWNER", email: "evil@x.com", emailConfirmed: true, ownerEmail: "me@x.com" })).toBe("USER");
    expect(resolveEffectiveRole({ dbRole: "OWNER", email: "me@x.com", emailConfirmed: true, ownerEmail: undefined })).toBe("USER");
    expect(resolveEffectiveRole({ dbRole: "USER", email: "me@x.com", emailConfirmed: true, ownerEmail: "me@x.com" })).toBe("USER");
    expect(resolveEffectiveRole({ dbRole: "ADMIN", email: "a@x.com", emailConfirmed: true, ownerEmail: "me@x.com" })).toBe("ADMIN");
  });
  it("never allows assigning OWNER", () => {
    expect(canAssignRole("OWNER", "USER", "ADMIN", false)).toBe(true);
    expect(canAssignRole("OWNER", "USER", "OWNER", false)).toBe(false);
    expect(canAssignRole("ADMIN", "USER", "ADMIN", false)).toBe(false);
    expect(canAssignRole("OWNER", "OWNER", "USER", false)).toBe(false);
    expect(canAssignRole("OWNER", "USER", "ADMIN", true)).toBe(false);
  });
});

describe("entitlements", () => {
  it("checks minutes and clip quotas", () => {
    expect(canProcessMinutes(free, 15).ok).toBe(true);
    expect(canProcessMinutes(free, 25).ok).toBe(false);
    expect(canProcessMinutes(free, 31).ok).toBe(false);
    expect(canProcessMinutes(owner, 10_000).ok).toBe(true);
    expect(clampClipCount(free, 10)).toBe(2);
    expect(clampClipCount(owner, 10)).toBe(10);
    expect(hasFeature(free, "virality_score")).toBe(false);
    expect(hasFeature(owner, "virality_score")).toBe(true);
  });
});

describe("upload validation", () => {
  const base = { size: 10_000_000, maxUploadMb: 500, maxVideoMinutes: 30, durationSeconds: 120 };
  it("accepts MP4/MOV/WEBM and rejects others", () => {
    expect(validateUpload({ ...base, filename: "a.mp4", type: "video/mp4" }).ok).toBe(true);
    expect(validateUpload({ ...base, filename: "a.MOV", type: "video/quicktime" }).ok).toBe(true);
    expect(validateUpload({ ...base, filename: "a.webm", type: "video/webm" }).ok).toBe(true);
    expect(validateUpload({ ...base, filename: "a.avi", type: "video/x-msvideo" }).ok).toBe(false);
    expect(validateUpload({ ...base, filename: "a.mp4.exe", type: "application/x-msdownload" }).ok).toBe(false);
    expect(validateUpload({ ...base, filename: "a.webm", type: "video/mp4" }).ok).toBe(false);
  });
  it("enforces size and duration", () => {
    expect(validateUpload({ ...base, filename: "a.mp4", size: 600 * 1024 * 1024 }).ok).toBe(false);
    expect(validateUpload({ ...base, filename: "a.mp4", durationSeconds: 31 * 60 }).ok).toBe(false);
    expect(validateUpload({ ...base, filename: "a.mp4", durationSeconds: 5 }).ok).toBe(false);
    expect(validateUpload({ ...base, filename: "a.mp4", size: 0 }).ok).toBe(false);
  });
  it("tolerates mp4/mov mime confusion", () => {
    expect(resolveMime("a.mov", "video/mp4")).toBe("video/quicktime");
    expect(resolveMime("a.mp4", "")).toBe("video/mp4");
  });
  it("sanitises filenames", () => {
    expect(safeFilename("../../etc/passwd<script>.mp4")).not.toMatch(/[/<>]/);
    expect(safeFilename("")).toBe("video");
  });
});

describe("subtitle presets", () => {
  it("gates presets by plan", () => {
    const classic = getPreset("classic")!;
    const bold = getPreset("bold")!;
    const karaoke = getPreset("karaoke")!;
    expect(canUsePreset(free, classic)).toBe(true);
    expect(canUsePreset(free, bold)).toBe(false);
    expect(canUsePreset(starter, bold)).toBe(true);
    expect(canUsePreset(starter, karaoke)).toBe(false);
    expect(SUBTITLE_PRESETS.every((p) => canUsePreset(owner, p))).toBe(true);
  });
  it("sanitises styles", () => {
    const base = getPreset("classic")!.style;
    const s = sanitizeStyle({ color: "red; evil", size: 5, font: "Comic Sans", wordsPerLine: 99 } as never, base);
    expect(s.color).toBe(base.color);
    expect(s.size).toBeLessThanOrEqual(0.09);
    expect(s.font).toBe(base.font);
    expect(s.wordsPerLine).toBe(8);
  });
});

describe("generation settings", () => {
  it("validates", () => {
    expect(generationSettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
    expect(generationSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, clipCount: 50 }).success).toBe(false);
    expect(generationSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, aspect: "4:3" }).success).toBe(false);
  });
  it("formats durations", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1:02:05");
  });
});
