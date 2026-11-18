/**
 * Browser-side compression of a My Collection custom item picture (PR 2b-3b).
 *
 * WHY IN THE BROWSER: Vercel limits a request body to about 4.5 MB whatever next.config says, so a 5 to 10 MB phone photo
 * cannot be posted to a server action. The picture is turned into a small WebP here first and only that is posted.
 * The server never trusts this: it re-checks type, size and the WebP bytes (see saved-custom-items-service.ts).
 *
 * The planning (resize, quality ladder, limits, messages) is the shared PURE code in custom-item-image.ts. The canvas
 * work sits behind a small "engine" so every outcome can be tested without a browser. This function never throws:
 * it returns the compressed WebP or a TYPED error with a ready-to-show message.
 */
import {
  MAX_STORED_BYTES,
  STORED_IMAGE_TYPE,
  compressionLadder,
  firstFittingStep,
  imageMessage,
  safeFileName,
  validateImageFile,
  type ImageErrorKind,
  type LadderStep,
} from "@/lib/products/saved-setups/custom-item-image";

export type CompressResult =
  | { ok: true; file: File; originalBytes: number; finalBytes: number }
  | { ok: false; kind: ImageErrorKind; error: string };

export type DecodedPicture = {
  width: number;
  height: number;
  /** Encodes the picture at one ladder step as WebP; null when this browser cannot produce WebP. */
  encode: (step: LadderStep) => Promise<Blob | null>;
  close: () => void;
};
export type PictureEngine = { decode: (file: File) => Promise<DecodedPicture> };

function fail(kind: ImageErrorKind, detail?: string | number): CompressResult {
  return { ok: false, kind, error: imageMessage(kind, detail) };
}

/** Core logic, engine-independent: validate input, decode, walk the shared ladder, build the File. */
export async function compressWithEngine(file: File, engine: PictureEngine): Promise<CompressResult> {
  try {
    // The name is only a label here: it is made safe first, so an odd file name never blocks a good picture.
    const checked = validateImageFile(file?.type, file?.size, safeFileName(file?.name, file?.type));
    if (!checked.ok) return fail(checked.kind, checked.kind === "too_large" ? file.size : checked.reason);

    let decoded: DecodedPicture;
    try {
      decoded = await engine.decode(file);
    } catch {
      return fail("unreadable");
    }
    if (!(decoded.width > 0) || !(decoded.height > 0)) {
      decoded.close();
      return fail("unreadable");
    }
    try {
      let unsupported = false;
      const found = await firstFittingStep(compressionLadder(decoded.width, decoded.height), async (step) => {
        const blob = await decoded.encode(step);
        if (!blob || blob.type !== STORED_IMAGE_TYPE) {
          unsupported = true; // this browser did not produce WebP
          return { size: Number.POSITIVE_INFINITY, value: null as Blob | null };
        }
        return { size: blob.size, value: blob as Blob | null };
      }, MAX_STORED_BYTES);
      if (unsupported && !found) return fail("unknown");
      if (!found || !found.value) return fail("too_detailed");
      const out = new File([found.value], safeFileName(file.name, STORED_IMAGE_TYPE), { type: STORED_IMAGE_TYPE, lastModified: Date.now() });
      return { ok: true, file: out, originalBytes: file.size, finalBytes: out.size };
    } finally {
      decoded.close();
    }
  } catch {
    return fail("unknown");
  }
}

// ── The real browser engine: createImageBitmap (EXIF auto-rotate) + canvas.toBlob("image/webp") ─────────────────────
async function decodeBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Some formats cannot be decoded by createImageBitmap: try an <img> element before giving up.
    }
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable")); };
    image.src = url;
  });
}

export const browserPictureEngine: PictureEngine = {
  async decode(file) {
    const source = await decodeBitmap(file);
    const width = "naturalWidth" in source ? source.naturalWidth : source.width;
    const height = "naturalHeight" in source ? source.naturalHeight : source.height;
    return {
      width,
      height,
      encode: (step) =>
        new Promise<Blob | null>((resolve) => {
          const canvas = document.createElement("canvas");
          canvas.width = step.width;
          canvas.height = step.height;
          const context = canvas.getContext("2d");
          if (!context) return resolve(null);
          context.clearRect(0, 0, step.width, step.height); // a transparent canvas keeps PNG/WebP transparency
          context.drawImage(source, 0, 0, step.width, step.height);
          canvas.toBlob((blob) => resolve(blob), STORED_IMAGE_TYPE, step.quality / 100);
        }),
      close: () => { if ("close" in source) source.close(); },
    };
  },
};

/** png/jpeg/webp up to 10 MB in; a WebP of at most 2 MB (long side <= 1600, quality 85 and down) out. Never throws. */
export function compressToWebp(file: File): Promise<CompressResult> {
  return compressWithEngine(file, browserPictureEngine);
}
