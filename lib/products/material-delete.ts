export type MaterialDeleteResult = {
  id: string; status: "deleted" | "in_use" | "not_found" | "error";
  message?: string; pictureRemoved?: boolean; pictureKept?: boolean;
};
export function chunkMaterialIds(ids: string[]): string[][] {
  const unique = [...new Set(ids)];
  return Array.from({ length: Math.ceil(unique.length / 100) }, (_, i) => unique.slice(i * 100, i * 100 + 100));
}
export function materialPictureAction(input: { status: string; imagePath: string | null; pictureInUse: boolean }): "remove" | "keep" | "none" {
  if (input.status !== "deleted" || !input.imagePath?.trim()) return "none";
  return input.pictureInUse ? "keep" : "remove";
}
// Only canonical Material Library object paths may be sent to Storage, especially with admin rights.
export function materialPicturePath(value: string): string | null {
  const path = value.trim().replace(/^product-images:/, "");
  return /^brand-materials\/[^/]+\/[^/]+\/.+/.test(path) && !/[\\%?#\u0000-\u001f]/.test(path) &&
    !path.split("/").some((part) => !part || part === "." || part === "..") ? path : null;
}
export function materialDeleteSummary(results: MaterialDeleteResult[]): string {
  const count = (test: (row: MaterialDeleteResult) => boolean) => results.filter(test).length;
  const kept = count((r) => r.pictureKept === true), failed = count((r) => r.pictureRemoved === false && !r.pictureKept);
  const parts = [`Deleted ${count((r) => r.status === "deleted")}.`, `Skipped ${count((r) => r.status === "in_use")} (in use).`, `${kept} pictures kept.`, `${failed} ${failed === 1 ? "picture" : "pictures"} could not be removed.`];
  const errors = count((r) => r.status === "error"), missing = count((r) => r.status === "not_found");
  if (errors) parts.push(`${errors} errors.`);
  if (missing) parts.push(`${missing} not found.`);
  return parts.join(" ");
}
