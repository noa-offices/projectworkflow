import Link from "next/link";
import { createProjectVariation, createQuotationOption, duplicateQuotation } from "@/app/quotations/actions";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { ExportExcelButton } from "@/components/quotations/export-excel-button";
import { QuotationPdfDocument } from "@/components/quotations/quotation-pdf-document";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { quotationLockReason, variationAppliedFromLayoutSettings } from "@/lib/quotations/quotation-lock";
import { loadQuotationPdfDocumentData } from "@/lib/quotations/quotation-pdf-document-data";
import { DEFAULT_QUOTATION_PDF_SETTINGS } from "@/lib/quotations/quotation-pdf-settings";
import { loadQuotationPdfSettings } from "@/lib/quotations/quotation-pdf-settings-store";

type LockedQuotationViewProps = {
  quotation: { id: string; layout_settings: unknown };
  role: string | null | undefined;
};

export async function LockedQuotationView({ quotation, role }: LockedQuotationViewProps) {
  const projectFile = projectFileFromLayoutSettings(quotation.layout_settings);
  const reason = quotationLockReason(quotation);
  const applied = variationAppliedFromLayoutSettings(quotation.layout_settings);
  const projectOrderNo = projectFile?.orderNo ?? applied?.orderNo ?? null;
  const canManageRecords = role === "system_owner" || role === "admin_manager" ||
    role === "procurement_manager" || role === "sales_designer" ||
    role === "sales_coordinator" || role === "designer";
  const [data, settingsResult] = await Promise.all([
    loadQuotationPdfDocumentData(quotation.id),
    loadQuotationPdfSettings(quotation.id),
  ]);
  const basePath = `/quotations/${quotation.id}`;
  const actionClassName = "inline-flex min-h-10 items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800";

  return (
    <>
      <section className="no-print border-b border-amber-200 bg-amber-50 px-5 py-5" aria-label="Quotation read-only">
        <h1 className="text-lg font-semibold text-zinc-950">Quotation is read-only</h1>
        <p className="mt-1 text-sm text-zinc-700">{reason}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {projectOrderNo ? <Link className={actionClassName} href={`/projects/orders/${encodeURIComponent(projectOrderNo)}`}>Open Project</Link> : null}
          <Link className={actionClassName} href={`${basePath}/pdf?print=1`}>Print quotation</Link>
          <Link className={actionClassName} href={`${basePath}/download-pdf`}>Download PDF</Link>
          <ExportExcelButton quotationId={quotation.id} className={actionClassName} />
          {canManageRecords ? (
            <>
              {/* Variations and options start from the Project's own quotation, never from an applied variation. */}
              {applied ? null : (
                <>
                  <form action={createProjectVariation}>
                    <input type="hidden" name="quotation_id" value={quotation.id} />
                    <input type="hidden" name="return_to" value={basePath} />
                    <PendingSubmitButton className={actionClassName} pendingLabel="Creating variation...">Create variation</PendingSubmitButton>
                  </form>
                  <form action={createQuotationOption}>
                    <input type="hidden" name="quotation_id" value={quotation.id} />
                    <input type="hidden" name="return_to" value={basePath} />
                    <PendingSubmitButton className={actionClassName} pendingLabel="Creating option...">Create option</PendingSubmitButton>
                  </form>
                </>
              )}
              <form action={duplicateQuotation}>
                <input type="hidden" name="quotation_id" value={quotation.id} />
                <input type="hidden" name="return_to" value={basePath} />
                <input type="hidden" name="duplicate_destination_mode" value="create_new_enquiry" />
                <PendingSubmitButton className={actionClassName} pendingLabel="Creating enquiry...">Copy to new enquiry</PendingSubmitButton>
              </form>
            </>
          ) : null}
        </div>
      </section>
      <QuotationPdfDocument data={data} settings={settingsResult.success ? settingsResult.settings : DEFAULT_QUOTATION_PDF_SETTINGS} showToolbar={false} />
    </>
  );
}
