"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { markProjectCompletedAction } from "@/lib/projects/mark-project-completed-action";

type Props = {
  quotationId: string;
  orderNo: string;
  completedAt: string | null;
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export function MarkCompletedButton({ quotationId, orderNo, completedAt }: Props) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (completedAt) {
    return (
      <span className="inline-flex h-10 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-800">
        ✓ Completed
        <span className="text-xs font-normal text-emerald-600">
          {formatDate(completedAt)}
        </span>
      </span>
    );
  }

  if (showConfirm) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
        <span className="text-xs font-semibold text-amber-800">
          Mark as completed? Moves to Completed Projects and removes from active Procurement Hub.
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={isLoading}
            onClick={async () => {
              setIsLoading(true);
              setError(null);
              const result = await markProjectCompletedAction(quotationId, orderNo);
              if (!result.ok) {
                setError(result.error);
                setIsLoading(false);
                return;
              }
              router.refresh();
            }}
            className="h-7 rounded-md bg-amber-700 px-3 text-xs font-semibold text-white transition hover:bg-amber-800 disabled:opacity-50"
          >
            {isLoading ? "Saving…" : "Confirm"}
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => { setShowConfirm(false); setError(null); }}
            className="h-7 rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {error ? (
          <span className="text-xs font-medium text-red-600">{error}</span>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setShowConfirm(true)}
      className="inline-flex h-10 items-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
    >
      Mark as Completed
    </button>
  );
}
