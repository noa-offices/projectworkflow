"use client";

const maxOptimizedImageSizeBytes = 3 * 1024 * 1024;
const maxLongEdgeCandidates = [2200, 2000, 1800];
const qualityCandidates = [0.92, 0.9, 0.88, 0.86, 0.84];
const supportedInputTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export type CompressProductImageResult = {
  compressionApplied: boolean;
  compressedFile: File;
  compressedSizeBytes: number;
  originalSizeBytes: number;
};

function extensionForMimeType(type: string) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "bin";
}

function filenameWithExtension(filename: string, extension: string) {
  const base = filename.replace(/\.[^.]+$/, "") || "image";
  return `${base}.${extension}`;
}

function safeCanvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error("Image could not be compressed in this browser."));
    }, type, quality);
  });
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Selected image could not be read."));
    };
    image.src = objectUrl;
  });
}

function resizedDimensions(width: number, height: number, maxLongEdge: number) {
  const longestEdge = Math.max(width, height);

  if (longestEdge <= maxLongEdge) {
    return { height, width };
  }

  const scale = maxLongEdge / longestEdge;
  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  };
}

function drawImageToCanvas(image: HTMLImageElement, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Image compression is not supported in this browser.");
  }

  context.drawImage(image, 0, 0, width, height);
  return canvas;
}

async function attemptCompression(
  canvas: HTMLCanvasElement,
  sourceFile: File,
  targetType: string,
  quality?: number,
) {
  const blob = await safeCanvasToBlob(canvas, targetType, quality);
  const extension = extensionForMimeType(targetType);
  return new File([blob], filenameWithExtension(sourceFile.name, extension), {
    lastModified: sourceFile.lastModified,
    type: targetType,
  });
}

export async function compressProductImage(file: File): Promise<CompressProductImageResult> {
  if (!supportedInputTypes.has(file.type)) {
    throw new Error("Only PNG, JPG, JPEG, and WebP images can be uploaded.");
  }

  const sourceImage = await loadImageFromFile(file);
  const preferredOutputType = "image/webp";
  const fallbackOutputType = file.type;
  const shouldKeepOriginal =
    file.size <= maxOptimizedImageSizeBytes &&
    Math.max(sourceImage.width, sourceImage.height) <= maxLongEdgeCandidates[0];

  if (shouldKeepOriginal) {
    return {
      compressedFile: file,
      compressedSizeBytes: file.size,
      compressionApplied: false,
      originalSizeBytes: file.size,
    };
  }

  let bestCandidate: File | null = null;

  for (const maxLongEdge of maxLongEdgeCandidates) {
    const { height, width } = resizedDimensions(
      sourceImage.width,
      sourceImage.height,
      maxLongEdge,
    );
    const canvas = drawImageToCanvas(sourceImage, width, height);

    for (const quality of qualityCandidates) {
      for (const outputType of [preferredOutputType, fallbackOutputType]) {
        const candidate = await attemptCompression(
          canvas,
          file,
          outputType,
          outputType === "image/png" ? undefined : quality,
        );

        if (!bestCandidate || candidate.size < bestCandidate.size) {
          bestCandidate = candidate;
        }

        if (candidate.size <= maxOptimizedImageSizeBytes) {
          return {
            compressedFile: candidate,
            compressedSizeBytes: candidate.size,
            compressionApplied:
              candidate.size !== file.size ||
              candidate.type !== file.type ||
              width !== sourceImage.width ||
              height !== sourceImage.height,
            originalSizeBytes: file.size,
          };
        }
      }
    }
  }

  if (bestCandidate && bestCandidate.size <= maxOptimizedImageSizeBytes) {
    return {
      compressedFile: bestCandidate,
      compressedSizeBytes: bestCandidate.size,
      compressionApplied: true,
      originalSizeBytes: file.size,
    };
  }

  throw new Error("Image is still larger than 3 MB after compression. Please choose a smaller image.");
}

export { maxOptimizedImageSizeBytes };
