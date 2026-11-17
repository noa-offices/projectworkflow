/**
 * Default name offered when saving a setup: the product (template) name FIRST, then the main code
 * (for example "Every EV211", "Jera Meeting 159 913"). It is only a default: the user can extend, edit or clear it.
 * Inner spaces of the template name are collapsed; the code is kept exactly as stored (it may contain a space).
 * If the template name already ends with the code, the code is not repeated.
 */
export function defaultSetupName({
  mainCode,
  templateName,
}: {
  mainCode?: string | null;
  templateName?: string | null;
}): string {
  const code = typeof mainCode === "string" ? mainCode.trim() : "";
  const name = typeof templateName === "string" ? templateName.replace(/\s+/g, " ").trim() : "";
  if (!code) return name;
  if (!name) return code;
  if (name.toLowerCase().endsWith(code.toLowerCase())) return name;
  return `${name} ${code}`;
}
