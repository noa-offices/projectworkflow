"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelProjectAction } from "@/lib/projects/cancel-project-action";

type Props = {
  quotationId: string;
  orderNo: string;
};

export function CancelProjectButton({ quotationId, orderNo }: Props) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (showConfirm) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
        <span className="text-xs font-semibold text-red-800">
          Cancel this project? It will be removed from Active Projects and active Procurement. This cannot be undone.
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={isLoading}
            onClick={async () => {
              setIsLoading(true);
              setError(null);
              const result = await cancelProjectAction(quotationId, orderNo);
              if (!result.ok) {
                setError(result.error);
                setIsLoading(false);
                return;
              }
              router.refresh();
            }}
            className="h-7 rounded-md bg-red-700 px-3 text-xs font-semibold text-white transition hover:bg-red-800 disabled:opacity-50"
          >
            {isLoading ? "Cancelling…" : "Confirm Cancel"}
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => { setShowConfirm(false); setError(null); }}
            className="h-7 rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 disabled:opacity-50"
          >
            Keep Project
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
      className="inline-flex h-10 items-center rounded-md border border-red-200 px-4 text-sm font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50"
    >
      Cancel Project
    </button>
  );
}
