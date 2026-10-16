/** Smart Setup keeps only a pending brand choice; the template editor owns the real selected brand and receives it on Apply. */
export function effectiveSmartSetupBrandId(pendingBrandId: string | null, editorBrandId: string) {
  return pendingBrandId ?? editorBrandId;
}
/** Changing the brand of an already-saved template away from its saved brand needs an explicit confirmation. */
export function smartSetupBrandChangeNeedsConfirmation(savedBrandId: string | null | undefined, nextBrandId: string) {
  return Boolean(savedBrandId) && nextBrandId !== savedBrandId;
}
/** The brand to hand to the editor on a successful Apply, or null when nothing changes. */
export function smartSetupBrandToCommit(pendingBrandId: string | null, editorBrandId: string) {
  return pendingBrandId !== null && pendingBrandId !== "" && pendingBrandId !== editorBrandId ? pendingBrandId : null;
}
/** Display-only hint from the imported JSON. It never selects or overrides a brand. */
export function jsonManufacturerHint(supplierName: string | null | undefined, selectedBrandName: string | null | undefined) {
  const name = supplierName?.trim();
  return name && name.toLowerCase() !== (selectedBrandName ?? "").trim().toLowerCase() ? name : null;
}
