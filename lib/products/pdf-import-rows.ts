import type { DetectedSwatch } from "./pdf-swatch-detect";

export type ImportLanguage = "italian" | "english" | "french" | "both";
export type ImportSubgroup = { id: string; name: string; grade: string | null };
// An ACTIVE material already in the group: its code, the sub-group it sits in (null = directly in the group) and a readable label ("CAT B - Crepe").
export type ExistingMaterial = { code: string; label: string; subgroupId: string | null };
export type ReviewRow = {
  swatch: DetectedSwatch; code: string; name: string; nameEdited: boolean;
  subgroupId: string | null; newSubgroup: { name: string; grade: string | null } | null;
  // Same code in the same sub-group (an existing material, or an earlier row of this list): blocked.
  duplicate: boolean;
  // The same code exists in OTHER sub-groups of the group (allowed, shown as an amber note): their labels.
  alsoIn: string[];
  checked: boolean;
};
export const importCodeKey = (value: string) => value.trim().toLowerCase();
export const subgroupText = (sub: { name: string; grade: string | null }) => [sub.grade, sub.name].filter(Boolean).join(" - ");
export function importName(item: DetectedSwatch, language: ImportLanguage) {
  if (language === "english") return item.nameEnglish || item.namePrimary;
  if (language === "french") return item.nameOther || item.nameEnglish || item.namePrimary;
  if (language === "both") return item.nameEnglish ? `${item.nameEnglish} / ${item.namePrimary}` : item.namePrimary;
  return item.namePrimary;
}

type Target = { newSubgroup: { name: string; grade: string | null } | null; subgroupId: string | null };
// Where a row will be saved: an existing sub-group, a sub-group to be created, or directly in the group.
const targetKey = (row: Target) =>
  row.subgroupId ? `s:${row.subgroupId}` : row.newSubgroup ? `n:${importCodeKey(row.newSubgroup.name)}|${importCodeKey(row.newSubgroup.grade || "")}` : "none";

// The duplicate rule: the same code (trimmed, case-insensitive, not empty) among ACTIVE materials of the same group AND the same sub-group
// (null equals only null). A code in another sub-group is only a note. Two rows of the same list with the same code and the same target
// are duplicates of each other (the later one). A row whose sub-group is still to be created cannot collide with existing materials.
export function evaluateRows<T extends Target & { code: string }>(rows: T[], existing: ExistingMaterial[], skip: (row: T) => boolean = () => false) {
  const seen = new Set<string>();
  return rows.map((row) => {
    const code = importCodeKey(row.code);
    if (!code || skip(row)) return { alsoIn: [] as string[], duplicate: false };
    const sameCode = existing.filter((item) => importCodeKey(item.code) === code);
    const creating = !row.subgroupId && Boolean(row.newSubgroup);
    const here = !creating && sameCode.some((item) => (item.subgroupId ?? null) === (row.subgroupId ?? null));
    const key = `${code}|${targetKey(row)}`;
    const repeat = seen.has(key);
    seen.add(key);
    const alsoIn = [...new Set(sameCode
      .filter((item) => creating || (item.subgroupId ?? null) !== (row.subgroupId ?? null))
      .map((item) => item.label || "No sub-group"))];
    return { alsoIn, duplicate: here || repeat };
  });
}

export function buildReviewRows(swatches: DetectedSwatch[], language: ImportLanguage, subgroups: ImportSubgroup[], existing: ExistingMaterial[]): ReviewRow[] {
  const rows = swatches.map((swatch) => {
    const name = importName(swatch, language).trim();
    const subgroup = subgroups.find((sub) => importCodeKey(sub.name) === importCodeKey(swatch.collection) && importCodeKey(sub.grade || "") === importCodeKey(swatch.grade));
    return { swatch, code: swatch.code.trim(), name, nameEdited: false, subgroupId: subgroup?.id ?? null,
      newSubgroup: !subgroup && swatch.collection.trim() ? { name: swatch.collection.trim(), grade: swatch.grade.trim() || null } : null,
      duplicate: false, alsoIn: [] as string[], checked: Boolean(name) };
  });
  const states = evaluateRows(rows, existing);
  // Ticked by default only when Ready: a code that also exists in another sub-group starts unticked (the user can still tick it).
  return rows.map((row, index) => ({ ...row, ...states[index], checked: !states[index].duplicate && states[index].alsoIn.length === 0 && row.checked }));
}
export function chunkImportRows<T>(rows: T[]): T[][] {
  return Array.from({ length: Math.ceil(rows.length / 20) }, (_, index) => rows.slice(index * 20, index * 20 + 20));
}
