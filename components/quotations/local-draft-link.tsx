"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getWorkspaceIndex } from "@/lib/local/quotation-db";
import type { LocalQuotationWorkspaceIndex } from "@/lib/local/quotation-workspace";

export function LocalDraftLink({
  quotationId,
  className = "",
  showLink = true,
}: {
  quotationId: string;
  className?: string;
  showLink?: boolean;
}) {
  const [draft, setDraft] = useState<LocalQuotationWorkspaceIndex | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getWorkspaceIndex(quotationId).then((value) => {
      if (!cancelled) {
        setDraft(value ?? null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [quotationId]);

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {showLink ? (
        <Link
          href={`/quotations/${quotationId}/local-builder`}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
        >
          Open Local Builder
        </Link>
      ) : null}
      {draft ? (
        <span
          className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
            draft.has_unsaved_changes
              ? "border border-amber-200 bg-amber-50 text-amber-900"
              : "border border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          {draft.has_unsaved_changes ? "Local draft" : "Local draft saved"}
        </span>
      ) : null}
    </div>
  );
}
