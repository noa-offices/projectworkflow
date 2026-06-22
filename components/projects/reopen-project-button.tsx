"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { reopenProjectAction } from "@/lib/projects/reopen-project-action";

export function ReopenProjectButton({
  quotationId,
  orderNo,
}: {
  quotationId: string;
  orderNo: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    const confirmed = window.confirm(
      `Revert ${orderNo} to Active?\n\nThis will move it back to the Active Projects list.`,
    );
    if (!confirmed) return;

    setPending(true);
    setError(null);
    try {
      const result = await reopenProjectAction(quotationId, orderNo);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
      } else {
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex h-10 items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50"
      >
        {pending ? "Reverting…" : "↩ Revert to Active"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
