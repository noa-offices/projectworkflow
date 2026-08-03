export const CLIENT_PAYMENT_ATTACHMENT_MAX_SIZE = 10 * 1024 * 1024;

export const CLIENT_PAYMENT_ATTACHMENT_MIME_EXTENSIONS: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
};

export function safeClientPaymentAttachmentFilename(originalName: string, mimeType: string) {
  const leafName = originalName.split(/[\\/]/).pop()?.trim() ?? "";
  const extension = leafName.includes(".") ? leafName.split(".").pop()!.toLowerCase() : "";
  if (!CLIENT_PAYMENT_ATTACHMENT_MIME_EXTENSIONS[mimeType]?.includes(extension)) return null;
  return `receipt-evidence.${extension}`;
}

export function clientPaymentAttachmentHasExpectedSignature(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "application/pdf") {
    return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  }
  if (mimeType === "image/png") {
    return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  }
  if (mimeType === "image/webp") {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}
