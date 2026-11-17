"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { saveSetup } from "@/lib/products/saved-setups/actions";
import type { SavedSetupPlainState } from "@/lib/products/saved-setups/recipe";

// Saves the CURRENT selections (ids + small overrides) as a private setup. Never sends a price or a line
// quantity. This is a plain button (type="button"), so it never submits the surrounding Add form.
export function SaveToMyCollectionButton({
  defaultName,
  state,
  templateId,
}: {
  defaultName: string;
  state: SavedSetupPlainState;
  templateId: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await saveSetup({ templateId, setupName: name, state });
      if (result.ok) {
        setMessage({ kind: "ok", text: "Saved to My Collection." });
        setOpen(false);
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  }

  return (
    <div className="mt-2">
      {open ? (
        <div className="space-y-2 border border-zinc-200 bg-zinc-50 p-2">
          <input
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              // This sits inside the Add form in the server builder: Enter must never submit that form.
              if (event.key === "Enter") {
                event.preventDefault();
                if (!pending && name.trim()) submit();
              }
            }}
            aria-label="Setup name"
            placeholder="Setup name"
            className="h-9 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || !name.trim()}
              onClick={submit}
              className="h-9 flex-1 bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {pending ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setOpen(false)}
              className="h-9 border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            setOpen(true);
          }}
          className="h-10 w-full border border-emerald-900 bg-white px-3 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-50"
        >
          Save to My Collection
        </button>
      )}
      {message ? (
        <p className={`mt-1 text-xs ${message.kind === "ok" ? "text-emerald-800" : "text-amber-700"}`}>
          {message.text}{" "}
          {message.kind === "ok" ? (
            <Link href="/products/my-collection" className="font-semibold underline">
              Open My Collection
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
