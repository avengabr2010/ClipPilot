/**
 * Client + server upload validation. The server re-validates everything
 * and the worker verifies the real container/codec with ffprobe, so client
 * checks are only for fast feedback.
 */
export const ACCEPTED_MIME = ["video/mp4", "video/quicktime", "video/webm"] as const;
export type AcceptedMime = (typeof ACCEPTED_MIME)[number];
export const ACCEPTED_EXT: Record<string, AcceptedMime> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm" };

export function extensionOf(filename: string): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec(filename.trim());
  return m ? m[1].toLowerCase() : "";
}

/** Resolves the MIME type from the extension, cross-checked with the browser-reported type. */
export function resolveMime(filename: string, reported: string | undefined): AcceptedMime | null {
  const fromExt = ACCEPTED_EXT[extensionOf(filename)];
  if (!fromExt) return null;
  if (reported && reported !== "" && reported !== "application/octet-stream") {
    if (!(ACCEPTED_MIME as readonly string[]).includes(reported)) return null;
    // .mov files are sometimes reported as video/mp4 and vice-versa (same ISO-BMFF family).
    const isoFamily = (t: string) => t === "video/mp4" || t === "video/quicktime";
    if (reported !== fromExt && !(isoFamily(reported) && isoFamily(fromExt))) return null;
  }
  return fromExt;
}

export type UploadCheck = { ok: true; mime: AcceptedMime } | { ok: false; error: string };

export function validateUpload(input: {
  filename: string;
  size: number;
  type?: string;
  durationSeconds?: number | null;
  maxUploadMb: number;
  maxVideoMinutes: number;
}): UploadCheck {
  const mime = resolveMime(input.filename, input.type);
  if (!mime) return { ok: false, error: "Format non pris en charge. Utilisez un fichier MP4, MOV ou WEBM." };
  if (!Number.isFinite(input.size) || input.size <= 0) return { ok: false, error: "Le fichier est vide." };
  if (input.size > input.maxUploadMb * 1024 * 1024) {
    return { ok: false, error: `Fichier trop volumineux : ${input.maxUploadMb} Mo maximum avec votre offre.` };
  }
  if (input.durationSeconds != null) {
    if (!Number.isFinite(input.durationSeconds) || input.durationSeconds < 10) {
      return { ok: false, error: "La vidéo doit durer au moins 10 secondes." };
    }
    if (input.durationSeconds > input.maxVideoMinutes * 60) {
      return { ok: false, error: `Vidéo trop longue : ${input.maxVideoMinutes} minutes maximum avec votre offre.` };
    }
  }
  return { ok: true, mime };
}

export function safeFilename(name: string): string {
  const base = name.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, " ").trim();
  return (base || "video").slice(0, 120);
}
