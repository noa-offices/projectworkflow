import Link from "next/link";
import { ArrowLeftRight, BarChart3, FolderTree, Plus } from "lucide-react";
import { canUseManagerMovements } from "@/lib/inventory/movement-form";
import { WORKER_MOVE_PATH, moveRequestAccess, requestButtons } from "@/lib/inventory/request-presentation";
import { buttonClass } from "./inventory-ui";
import { MoreMenu } from "./inventory-ui-client";

/**
 * The one action row for Overview and Products: Add item is the only primary button,
 * Move stock is secondary (managers), Take / Move stock is the worker request button, and Manage categories lives in the More menu.
 */
export function InventoryActions({ role, addHref = "/inventory/requests/new-product", moveHref = "/inventory/move", categoriesHref = "/inventory/categories", reportsHref = "/inventory/reports", requestMoveHref = WORKER_MOVE_PATH }: { requestMoveHref?: string; reportsHref?: string; role?: string | null; addHref?: string; moveHref?: string; categoriesHref?: string }) {
  const canAdd = requestButtons(role).add, manager = canUseManagerMovements(role), worker = moveRequestAccess(role) === "worker";
  if (!canAdd && !manager) return null;
  return <div data-inventory-actions className="flex min-w-0 items-center gap-2">
    {canAdd ? <Link href={addHref} className={`${buttonClass.primary} min-w-0 flex-1`}><Plus size={18} aria-hidden="true" />Add item</Link> : null}
    {manager ? <Link href={moveHref} className={`${buttonClass.secondary} min-w-0 flex-1`}><ArrowLeftRight size={16} aria-hidden="true" />Move stock</Link> : null}
    {worker ? <Link href={requestMoveHref} className={`${buttonClass.secondary} min-w-0 flex-1 text-center`}><ArrowLeftRight size={16} aria-hidden="true" />Take / Move stock</Link> : null}
    {manager ? <MoreMenu items={[{ href: categoriesHref, label: "Manage categories", icon: <FolderTree size={16} aria-hidden="true" /> }, { href: reportsHref, label: "Reports", icon: <BarChart3 size={16} aria-hidden="true" /> }]} /> : null}
  </div>;
}
