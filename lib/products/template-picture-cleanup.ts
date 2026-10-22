const prefixes = ["product-templates", "product-template-row-references", "product-template-subgroup-references", "product-template-group-references", "product-template-references"];
export function templatePicturePath(value: unknown, templateId: string): string | null {
  if (typeof value !== "string") return null;
  let path = value;
  if (path.startsWith("product-images:")) path = path.slice(15);
  else if (/^https?:\/\//i.test(path)) {
    try {
      const match = new URL(path).pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/product-images\/(.+)$/);
      if (!match) return null;
      path = decodeURIComponent(match[1]);
    } catch { return null; }
  }
  if (path.length > 300 || /[\\%?#\u0000-\u001f]/.test(path) || path.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return prefixes.some((prefix) => path.startsWith(`${prefix}/${templateId}/`)) ? path : null;
}
export function collectPicturePaths(values: unknown[], templateId: string) {
  return [...new Set(values.map((value) => templatePicturePath(value, templateId)).filter((value): value is string => value !== null))];
}
export type PictureCleanup = { removed: number; kept: number; warning: boolean; guardFailed?: boolean };
type RemoveResult = { paths: string[]; error: boolean };
export async function cleanupPictures(paths: string[] | null, deps: {
  guard: (paths: string[]) => Promise<string[]>;
  userRemove: (paths: string[]) => Promise<RemoveResult>;
  adminRemove: (paths: string[]) => Promise<RemoveResult>;
}): Promise<PictureCleanup> {
  const result: PictureCleanup = { removed: 0, kept: 0, warning: false };
  if (!paths) return { ...result, warning: true, guardFailed: true };
  const used = new Set<string>();
  try {
    // Finish ALL guard batches before removing ANY object.
    for (let i = 0; i < paths.length; i += 500) {
      const batch = paths.slice(i, i + 500), references = await deps.guard(batch);
      if (!Array.isArray(references) || references.some((path) => !batch.includes(path))) throw Error("Invalid guard response");
      references.forEach((path) => used.add(path));
    }
  } catch { return { ...result, warning: true, guardFailed: true }; }
  result.kept = used.size;
  const pending = paths.filter((path) => !used.has(path));
  for (let i = 0; i < pending.length; i += 100) {
    const batch = pending.slice(i, i + 100);
    let remaining = batch;
    for (const remove of [deps.userRemove, deps.adminRemove]) {
      if (!remaining.length) break;
      try {
        const response = await remove(remaining);
        const confirmed = response.error ? [] : remaining.filter((path) => response.paths.includes(path));
        result.removed += confirmed.length;
        remaining = remaining.filter((path) => !confirmed.includes(path));
      } catch { /* Retry unconfirmed paths with the admin client, then report any remainder. */ }
    }
    if (remaining.length) result.warning = true;
  }
  return result;
}
export function pictureCleanupMessage(result: PictureCleanup) {
  return `${result.warning ? " Product deleted. Some files could not be removed." : ""}${result.guardFailed ? (result.removed ? " Picture safety check unavailable for some products; unchecked files retained." : " Picture safety check unavailable; no files removed.") : ""} ${result.removed} files removed, ${result.kept} kept because a quotation uses them.`;
}
