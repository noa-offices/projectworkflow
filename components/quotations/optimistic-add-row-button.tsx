"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createBlankQuotationItemOptimistic } from "@/app/quotations/actions";

export function OptimisticAddRowButton({
  quotationId,
  returnTo,
  sectionId,
}: {
  quotationId: string;
  returnTo: string;
  sectionId: string;
}) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function submitCreate() {
    const formData = new FormData();
    formData.set("quotation_id", quotationId);
    formData.set("section_id", sectionId);
    formData.set("currency", "AED");
    formData.set("return_to", returnTo);

    setErrorMessage("");
    startTransition(() => {
      void createBlankQuotationItemOptimistic(formData)
        .then((result) => {
          if (!result.ok) {
            setErrorMessage(result.message);
            return;
          }

          router.refresh();
        })
        .catch((error: unknown) => {
          setErrorMessage(error instanceof Error ? error.message : "Blank row could not be created.");
        });
    });
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={submitCreate}
        disabled={isPending}
        className="border border-zinc-300 bg-white px-3 py-2 text-xs font-bold text-emerald-900 transition hover:bg-emerald-50 disabled:cursor-wait disabled:text-zinc-400"
      >
        {isPending ? "Adding row..." : "+ Item Row"}
      </button>
      {isPending ? (
        <div className="border border-dashed border-emerald-300 bg-white px-3 py-2 text-xs text-zinc-600">
          Creating a blank row in this section...
        </div>
      ) : null}
      {errorMessage ? (
        <div className="flex items-center gap-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={submitCreate}
            className="font-semibold underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}
