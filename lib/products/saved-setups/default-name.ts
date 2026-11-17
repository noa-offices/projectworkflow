/**
 * Default name offered when saving a setup: the product's MAIN CODE (for example "EV211") when there is one,
 * otherwise the template name. It is only a default: the user can extend, edit or clear it.
 */
export function defaultSetupName({
  mainCode,
  templateName,
}: {
  mainCode?: string | null;
  templateName?: string | null;
}): string {
  const code = typeof mainCode === "string" ? mainCode.trim() : "";
  if (code) return code;
  return typeof templateName === "string" ? templateName.trim() : "";
}
