import type { InventoryCategoryNode } from "./types";

export const CATEGORY_NAME_MAX = 200;

/** Plain-words problem with a category name, or null when it is fine. Siblings are the names beside it. */
export function categoryNameError(name: string, siblings: readonly Pick<InventoryCategoryNode, "id" | "name">[], editingId?: string): string | null {
  const text = name.trim();
  if (!text) return "Enter a name.";
  if (text.length > CATEGORY_NAME_MAX) return `Keep the name under ${CATEGORY_NAME_MAX} characters.`;
  const lower = text.toLowerCase();
  if (siblings.some(row => row.id !== editingId && row.name.trim().toLowerCase() === lower)) return "A category with that name already exists here.";
  return null;
}
/** Names that share a level with the one being added or renamed. */
export function categorySiblings(tree: readonly InventoryCategoryNode[], parentId: string | null): InventoryCategoryNode[] {
  return parentId ? tree.find(row => row.id === parentId)?.children ?? [] : [...tree];
}
export const categoryVisibilityLabel = (active: boolean): string => active ? "Visible" : "Hidden";
