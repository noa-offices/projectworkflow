import Link from "next/link";
import { ArrowLeftRight, FolderTree } from "lucide-react";
import { canUseManagerMovements } from "@/lib/inventory/movement-form";

const link = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700";

/** Move stock and Manage categories. Renders nothing unless the role is a manager. */
export function ManagerShortcuts({ role, moveHref = "/inventory/move", categoriesHref = "/inventory/categories" }: { role?: string | null; moveHref?: string; categoriesHref?: string }) {
  if (!canUseManagerMovements(role)) return null;
  return <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
    <Link href={moveHref} className={link}><ArrowLeftRight size={16} aria-hidden="true" />Move stock</Link>
    <Link href={categoriesHref} className={link}><FolderTree size={16} aria-hidden="true" />Manage categories</Link>
  </div>;
}
