// Phase 5.1 — server-side magic-byte sniffer for upload routes.
// Browser-supplied `Content-Type` is trivially spoofed; this peeks at the
// first bytes of the buffer to determine the real format.

export type DetectedFormat = "png" | "jpeg" | "webp" | "gif" | "pdf" | "svg" | "unknown";

export function detectImageOrPdf(buf: Uint8Array): DetectedFormat {
  if (buf.length < 4) return "unknown";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  // GIF: 47 49 46 38 (GIF8)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "gif";
  // PDF: %PDF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "pdf";
  // WEBP: "RIFF" .... "WEBP"
  if (buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "webp";
  // SVG: starts with "<?xml" or "<svg" (sometimes preceded by BOM/whitespace).
  // We sniff the first ~256 chars as text and look for the marker.
  const head = new TextDecoder("utf-8", { fatal: false }).decode(buf.subarray(0, Math.min(256, buf.length)));
  const lower = head.toLowerCase().trimStart();
  if (lower.startsWith("<?xml") || lower.startsWith("<svg") || lower.includes("<svg")) return "svg";
  return "unknown";
}

const SAFE_RASTER: ReadonlySet<DetectedFormat> = new Set(["png", "jpeg", "webp"]);
const SAFE_RASTER_OR_GIF: ReadonlySet<DetectedFormat> = new Set(["png", "jpeg", "webp", "gif"]);
const SAFE_PRESCRIPTION: ReadonlySet<DetectedFormat> = new Set(["png", "jpeg", "webp", "pdf"]);

export const SAFE_FORMATS = {
  raster: SAFE_RASTER,
  rasterOrGif: SAFE_RASTER_OR_GIF,
  prescription: SAFE_PRESCRIPTION,
};

// Header MIME for re-serving; never trust the browser-provided one for the
// stored object's content-type.
const MIME: Record<DetectedFormat, string> = {
  png:  "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif:  "image/gif",
  pdf:  "application/pdf",
  svg:  "image/svg+xml",
  unknown: "application/octet-stream",
};

const EXT: Record<DetectedFormat, string> = {
  png: "png", jpeg: "jpg", webp: "webp", gif: "gif", pdf: "pdf", svg: "svg", unknown: "bin",
};

export function mimeOf(fmt: DetectedFormat): string {
  return MIME[fmt];
}
export function extOf(fmt: DetectedFormat): string {
  return EXT[fmt];
}
