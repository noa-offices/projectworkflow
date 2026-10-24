import Link from 'next/link';
import { requestButtons } from '@/lib/inventory/request-presentation';

export function AddItemButton({ role }: { role?: string | null }) {
  if (!requestButtons(role).add) return null;
  return <Link href="/inventory/requests/new-product" className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-emerald-900 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Add item</Link>;
}
