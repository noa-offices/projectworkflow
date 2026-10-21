export type SubgroupText = { grade: string | null; name: string };

// Keeps the old text columns in step with a material's sub-group (other code still reads them through "category || collection"):
//  * sub-group with a grade:  material_collection = name,  material_category = grade
//  * sub-group without grade: material_collection = null,  material_category = name
// Returns null when there is no sub-group, so callers keep today's behaviour.
export function materialTextForSubgroup(subgroup: SubgroupText | null | undefined) {
  if (!subgroup) return null;
  const name = subgroup.name.trim();
  const grade = subgroup.grade?.trim() || null;
  return grade
    ? { material_category: grade, material_collection: name }
    : { material_category: name, material_collection: null };
}
