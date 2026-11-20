"use client";

import { useState, useTransition } from "react";
import { AddFromGalleryPicker } from "@/components/quotations/add-from-gallery-picker";
import { getGalleryItemForAddAction } from "@/lib/products/gallery/gallery-actions";
import { openGalleryPick } from "@/lib/products/gallery/gallery-add-flow";
import type { SetupForUse } from "@/lib/products/saved-setups/saved-setups-service";

/**
 * "Add from Gallery": opens the read-only gallery picker; choosing an item loads its saved setup and hands it to `onChoose`, the SAME
 * replay as My Collection (it opens the configurator pre-filled). Nothing is added here and no price is read, shown or passed: the user
 * presses the normal Add, which prices from the current Product Library.
 * `onChoose` returns an error message to keep this dialog open with a notice, or null when it took over.
 */
export function AddFromGalleryButton({ onChoose }: { onChoose: (setup: SetupForUse) => string | null }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  function pick(item: { id: string; name: string }) {
    if (pending) return;
    setNotice("");
    startTransition(async () => {
      const result = await openGalleryPick(item.id, getGalleryItemForAddAction, onChoose);
      if (result.ok) setOpen(false);
      else setNotice(result.message);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setNotice(""); setOpen(true); }}
        className="border border-zinc-300 bg-white px-3 py-2 text-xs font-bold text-emerald-900 transition hover:bg-emerald-50"
      >
        Add from Gallery
      </button>
      {open ? (
        <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-zinc-950/30 p-0 sm:items-center sm:p-[3vw]">
          <div className="flex h-full w-full flex-col overflow-hidden bg-white shadow-xl sm:h-[90vh] sm:w-[min(1100px,94vw)] sm:rounded-lg sm:border sm:border-zinc-300">
            {notice ? <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{notice}</p> : null}
            <div className="min-h-0 flex-1 overflow-hidden">
              <AddFromGalleryPicker open onClose={() => setOpen(false)} onPick={pick} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
