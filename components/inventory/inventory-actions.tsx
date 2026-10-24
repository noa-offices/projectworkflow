import Link from "next/link";
import { ArrowLeftRight, FolderTree, Plus } from "lucide-react";
import { canUseManagerMovements } from "@/lib/inventory/movement-form";
import { requestButtons } from "@/lib/inventory/request-presentation";
import { buttonClass } from "./inventory-ui";
import { MoreMenu } from "./inventory-ui-client";

/**
 * The one action row for Overview and Products: Add item is the only primary button,
 * Move stock is secondary (managers), and Manage categories lives in the More menu.
 */
export function InventoryActions({ role, addHref = "/inventory/requests/new-product", moveHref = "/inventory/move", categoriesHref = "/inventory/categories" }: { role?: string | null; addHref?: string; moveHref?: string; categoriesHref?: string }) {
  const canAdd = requestButtons(role).add, manager = canUseManagerMovements(role);
  if (!canAdd && !manager) return null;
  return <div data-inventory-actions className="flex min-w-0 items-center gap-2">
    {canAdd ? <Link href={addHref} className={`${buttonClass.primary} min-w-0 flex-1`}><Plus size={18} aria-hidden="true" />Add item</Link> : null}
    {manager ? <Link href={moveHref} className={`${buttonClass.secondary} min-w-0 flex-1`}><ArrowLeftRight size={16} aria-hidden="true" />Move stock</Link> : null}
    {manager ? <MoreMenu items={[{ href: categoriesHref, label: "Manage categories", icon: <FolderTree size={16} aria-hidden="true" /> }]} /> : null}
  </div>;
}
