"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateQuotationStatus } from "@/app/quotations/actions";

const STATUS_OPTIONS = [
  ["draft", "Draft"],
  ["internal_review", "Internal Review"],
  ["sent_to_client", "Sent to Client"],
  ["revision_required", "Revision Requested"],
  ["client_confirmed", "Client Approved"],
  ["on_hold", "On Hold"],
  ["cancelled", "Rejected / Lost"],
] as const;

type ActionResult<T> =
  | { ok: true; data: T; message: string }
  | { ok: false; error: string };

function isActionResult<T>(value: unknown): value is ActionResult<T> {
  return typeof value === "object" && value !== null && "ok" in value;
}

type Props = {
  quotationId: string;
  currentStatus: string;
};

export function QuotationStatusSelector({ quotationId, currentStatus }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [statusValue, setStatusValue] = useState(currentStatus);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    if (
      statusValue === "cancelled" &&
      !window.confirm(
        "Mark as Rejected / Lost?\n\nThis will close the quotation folder. This action can be reversed by changing the status again.",
      )
    ) return;

    startTransition(async () => {
      setMessage(null);
      setError(null);

      const formData = new FormData();
      formData.set("quotation_id", quotationId);
      formData.set("status", statusValue);
      formData.set("return_to", `/quotations/${quotationId}`);
      formData.set("result_mode", "optimistic");

      try {
        const result = await updateQuotationStatus(formData);
        if (!isActionResult<{ status: string }>(result) || !result.ok) {
          setStatusValue(currentStatus);
          setError(isActionResult(result) && !result.ok ? result.error : "Could not update status.");
          return;
        }
        setMessage("Status updated.");
        router.refresh();
      } catch {
        setStatusValue(currentStatus);
        setError("Could not update status.");
      }
    });
  }

  return (
    <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Change status</span>
        <select
          value={statusValue}
          onChange={(event) => setStatusValue(event.target.value)}
          disabled={isPending}
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        >
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <div className="mt-2 flex items-center justify-between gap-3">
        {(message || error) ? (
          <p className={`text-xs font-medium ${error ? "text-red-700" : "text-emerald-800"}`}>
            {error ?? message}
          </p>
        ) : <span />}
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="h-9 rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:bg-zinc-400"
        >
          {isPending ? "Saving..." : "Update"}
        </button>
      </div>
    </div>
  );
}
