"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CustomItemForm } from "@/components/products/my-collection-custom-items";
import { customItemFromRow, type ManualRowLike } from "@/lib/products/saved-setups/custom-item-line";
import { distinctBrands, type BrandCount } from "@/lib/products/saved-setups/custom-brands";
import { quoteImageStoragePath } from "@/lib/products/saved-setups/custom-item-image";
import { listCustomItems } from "@/lib/products/saved-setups/saved-custom-items-actions";

// Row More-menu entry for MANUAL item rows ("+ Item Row"): opens a popup (a real modal, not inside the menu)
// with the form prefilled from the row. Product, note, blank and heading rows render nothing.
// The popup saves through the existing createCustomItem action (owner from the session).
// A picture on the row is preselected (Remove / Replace work) and copied into My Collection on save.
// The row's own picture ("quote-images:quotation-items/...") is offered in the popup and copied only when the user saves.
export type ManualRowWithImages = ManualRowLike & { proposed_image_url_snapshot?: string | null; specified_image_url_snapshot?: string | null };

function rowPictureRef(row: ManualRowWithImages): string | null {
  const ref = row.proposed_image_url_snapshot || row.specified_image_url_snapshot;
  return typeof ref === "string" && quoteImageStoragePath(ref) ? ref : null;
}

export function SaveAsCustomItemButton({ row }: { row: ManualRowWithImages }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [brands, setBrands] = useState<BrandCount[]>([]);

  // The brand list comes from the owner's own items (existing list action; caller's session, no admin client).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listCustomItems()
      .then((items) => { if (!cancelled) setBrands(distinctBrands(items)); })
      .catch(() => { if (!cancelled) setBrands([]); });
    return () => { cancelled = true; };
  }, [open]);

  const prefilled = customItemFromRow(row);
  if (!prefilled.ok) return null;

  function close() {
    setOpen(false);
    setSaved(false);
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-7 w-full border border-emerald-200 bg-emerald-50 px-2 text-left text-xs font-semibold text-emerald-900 transition hover:border-emerald-300"
      >
        Save as custom item
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/30 p-4"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
        >
          <div role="dialog" aria-modal="true" aria-label="Save as custom item" className="max-h-[90vh] w-full max-w-[640px] overflow-y-auto rounded-lg border border-zinc-300 bg-white p-4 text-left shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-950">Save as custom item</h2>
                <p className="text-xs text-zinc-500">Saved privately to My Collection. Quantity and discount are not saved.</p>
              </div>
              <button type="button" onClick={close} className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900">Close</button>
            </div>
            {saved ? (
              <p className="text-sm text-emerald-800">
                Saved to My Collection.{" "}
                <Link href="/products/my-collection" className="font-semibold underline">Open My Collection</Link>
              </p>
            ) : (
              <CustomItemForm item={null} defaults={prefilled.defaults} brands={brands} rowImageRef={rowPictureRef(row)} onDone={close} onSaved={() => setSaved(true)} />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
