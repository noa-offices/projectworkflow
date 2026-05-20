"use client";

import { useMemo, useState } from "react";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { permanentlyDeleteProjectAndLinkedQuotations } from "@/app/clients/actions";

export function DeleteProjectWithQuotationsDialog({
  projectId,
  projectName,
  quotationCount,
}: {
  projectId: string;
  projectName: string;
  quotationCount: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");

  const canDelete = useMemo(() => {
    return confirmationText === projectName || confirmationText === "DELETE PROJECT";
  }, [confirmationText, projectName]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex h-8 items-center rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50"
      >
        Delete project and linked quotations
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white shadow-xl">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-zinc-950">
                Delete project and linked quotations?
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                This will permanently delete <span className="font-semibold text-zinc-950">{projectName}</span> and{" "}
                {quotationCount} linked {quotationCount === 1 ? "quotation" : "quotations"}.
              </p>
            </div>

            <div className="px-5 py-4">
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                <p className="font-semibold">This will permanently delete:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>this project</li>
                  <li>all linked quotations</li>
                  <li>quotation items</li>
                  <li>quotation sections</li>
                  <li>quotation presentation settings</li>
                  <li>procurement RFQ settings</li>
                  <li>purchase order settings</li>
                  <li>order confirmation settings</li>
                  <li>quotation activity logs and related document settings</li>
                </ul>
                <p className="mt-3 font-semibold">This cannot be undone.</p>
              </div>

              <div className="mt-4 grid gap-2">
                <label className="grid gap-1">
                  <span className="text-xs font-semibold uppercase text-zinc-500">
                    Type the project name exactly, or type DELETE PROJECT
                  </span>
                  <input
                    value={confirmationText}
                    onChange={(event) => setConfirmationText(event.target.value)}
                    className="h-10 rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/10"
                    placeholder={projectName}
                  />
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-zinc-200 px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  setConfirmationText("");
                }}
                className="inline-flex h-10 items-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
              >
                Cancel
              </button>
              <form action={permanentlyDeleteProjectAndLinkedQuotations}>
                <input type="hidden" name="id" value={projectId} />
                <input type="hidden" name="project_name" value={projectName} />
                <input type="hidden" name="confirmation_text" value={confirmationText} />
                <PendingSubmitButton
                  className="inline-flex h-10 items-center rounded-md border border-red-200 bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-300"
                  disabled={!canDelete}
                  pendingLabel="Deleting project..."
                >
                  Permanently delete project and linked quotations
                </PendingSubmitButton>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
