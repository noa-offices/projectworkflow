export type MaterialSortMode = "code" | "name" | "recent";

type Sortable = { code: string; createdAt?: string | null; name: string };

// Natural order: 10 comes after 9, "A2" before "A10", letters ignore case.
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const natural = (left: string, right: string) => collator.compare(left.trim(), right.trim());

function byCode(left: Sortable, right: Sortable) {
  const leftEmpty = !left.code.trim();
  const rightEmpty = !right.code.trim();
  // Materials without a code go to the end, ordered by name.
  if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
  return (leftEmpty ? 0 : natural(left.code, right.code)) || natural(left.name, right.name);
}

export function sortMaterials<T extends Sortable>(items: T[], mode: MaterialSortMode): T[] {
  const copy = [...items];
  if (mode === "name") return copy.sort((left, right) => natural(left.name, right.name) || natural(left.code, right.code));
  if (mode === "recent") {
    // Newest first; rows without a date go last. Ties keep the code order.
    return copy.sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? "") || byCode(left, right));
  }
  return copy.sort(byCode);
}

// Sub-group cards: sort_order, then grade (natural), then name (natural).
export function compareSubgroups(
  left: { grade: string | null; name: string; sort_order: number },
  right: { grade: string | null; name: string; sort_order: number },
) {
  return left.sort_order - right.sort_order || natural(left.grade ?? "", right.grade ?? "") || natural(left.name, right.name);
}
