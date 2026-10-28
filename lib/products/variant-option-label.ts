/** Variant dropdown label: primary supplier code + name. Dimension and price are shown in the detail box, never here. */
export function variantOptionLabel({ code, name }: { code?: string | null; name: string }): string {
  const label = name.trim();
  const primary = code?.split(/[,;\n]/)[0]?.trim() ?? "";
  if (!primary) return label;
  const escaped = primary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}(?![\\p{L}\\p{N}])`, "iu").test(label) ? label : `${primary} - ${label}`;
}
