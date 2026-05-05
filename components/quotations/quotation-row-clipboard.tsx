"use client";

import { useEffect, useState } from "react";
import { pasteCopiedQuotationItem } from "@/app/quotations/actions";

const clipboardKey = "projectworkflow.copiedQuotationRow";
const clipboardEvent = "projectworkflow:copiedQuotationRow";

type ClipboardPayload = {
  copied_at: string;
  source_item_id: string;
  source_quotation_id: string;
  source_quotation_label: string;
  source_section_id: string | null;
  row_snapshot: Record<string, unknown>;
};

function readClipboard() {
  if (typeof window === "undefined") return null;

  const rawValue = window.localStorage.getItem(clipboardKey);
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue) as ClipboardPayload;
    return parsed.row_snapshot ? parsed : null;
  } catch {
    return null;
  }
}

export function CopyQuotationRowButton({
  payload,
}: {
  payload: ClipboardPayload;
}) {
  const [copied, setCopied] = useState(false);

  function copyRow() {
    window.localStorage.setItem(clipboardKey, JSON.stringify(payload));
    window.dispatchEvent(new Event(clipboardEvent));
    setCopied(true);
  }

  return (
    <div className="grid gap-1">
      <button
        type="button"
        onClick={copyRow}
        className="h-7 border border-zinc-300 bg-white px-2 text-left text-xs font-semibold text-emerald-900 transition hover:border-emerald-900"
      >
        Copy row
      </button>
      {copied ? (
        <p className="text-[11px] leading-4 text-emerald-900">
          Row copied. Paste it into any section.
        </p>
      ) : null}
    </div>
  );
}

export function PasteQuotationRowControls({
  quotationId,
  returnTo,
  sectionId,
}: {
  quotationId: string;
  returnTo: string;
  sectionId: string;
}) {
  const [clipboard, setClipboard] = useState<ClipboardPayload | null>(null);

  useEffect(() => {
    function syncClipboard() {
      setClipboard(readClipboard());
    }

    syncClipboard();
    window.addEventListener("storage", syncClipboard);
    window.addEventListener(clipboardEvent, syncClipboard);

    return () => {
      window.removeEventListener("storage", syncClipboard);
      window.removeEventListener(clipboardEvent, syncClipboard);
    };
  }, []);

  function clearClipboard() {
    window.localStorage.removeItem(clipboardKey);
    window.dispatchEvent(new Event(clipboardEvent));
    setClipboard(null);
  }

  if (!clipboard) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
      <form action={pasteCopiedQuotationItem} className="flex items-center gap-2">
        <input type="hidden" name="quotation_id" value={quotationId} />
        <input type="hidden" name="section_id" value={sectionId} />
        <input type="hidden" name="return_to" value={returnTo} />
        <input
          type="hidden"
          name="row_snapshot"
          value={JSON.stringify(clipboard.row_snapshot)}
        />
        <button
          type="submit"
          className="h-8 rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
        >
          Paste row
        </button>
      </form>
      <button
        type="button"
        onClick={clearClipboard}
        className="h-8 rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-600 transition hover:text-zinc-950"
      >
        Clear copied row
      </button>
      <span className="text-xs text-emerald-950">
        Copied from {clipboard.source_quotation_label}
      </span>
    </div>
  );
}
