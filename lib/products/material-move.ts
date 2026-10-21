export const moveCodeKey = (value: string | null | undefined) => (value || "").trim().toLowerCase();

// Duplicate guard for moving a material into a sub-group: the same code (trimmed, case-insensitive, not empty) must not already exist
// among the ACTIVE materials of the target sub-group. A material already in the target does not collide with itself.
export function moveDecision(
  material: { code: string | null; isActive: boolean; subgroupId: string | null },
  targetId: string | null,
  targetCodes: Set<string>,
): "ok" | "duplicate" {
  const key = moveCodeKey(material.code);
  if (!targetId || !key || material.subgroupId === targetId) return "ok";
  return targetCodes.has(key) ? "duplicate" : "ok";
}
