"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { updateQuotationDocumentSetup } from "@/app/quotations/actions";
import type { ResolvedDocumentSetup } from "@/lib/quotations/document-setup";

type DocumentSetupDialogProps = {
  clientId: string;
  hasProject: boolean;
  projectId: string | null;
  quotationId: string;
  returnTo: string;
  setup: ResolvedDocumentSetup;
  triggerClassName?: string;
};

const tabs = [
  "Header Details",
  "Commercial Terms",
  "Document Visibility",
  "Notes & Footer",
  "Revision / Option Info",
] as const;

export function DocumentSetupDialog({
  clientId,
  hasProject,
  projectId,
  quotationId,
  returnTo,
  setup,
  triggerClassName,
}: DocumentSetupDialogProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("Header Details");
  const [isSaving, setIsSaving] = useState(false);
  const [, startTransition] = useTransition();
  const systemFields = useMemo(() => [
    ["Quotation No", setup.header.quotationNo ?? "Draft"],
    ["Quotation Folder", setup.header.folderNo ?? "Legacy"],
    ["Opportunity No", setup.header.opportunityNo ?? "Legacy opportunity"],
    ["Client No", setup.header.clientNo ?? "-"],
    ["Type", setup.revisionOption.sequenceLabel ? `${setup.revisionOption.type} ${setup.revisionOption.sequenceLabel}` : setup.revisionOption.type],
  ], [setup]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;

    const formData = new FormData(event.currentTarget);
    setIsSaving(true);
    startTransition(() => {
      void updateQuotationDocumentSetup(formData).finally(() => {
        setIsSaving(false);
      });
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={triggerClassName ?? "inline-flex h-11 items-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"}
      >
        Document Setup
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 bg-zinc-950/40 p-4 backdrop-blur-sm">
          <div className="mx-auto flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-900">Quotation Folder</p>
                <h2 className="mt-1 text-xl font-semibold text-zinc-950">Document Setup</h2>
                <p className="mt-1 text-sm text-zinc-500">Header, terms, notes, and document display settings for this quotation.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 items-center rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
              <input type="hidden" name="quotation_id" value={quotationId} />
              <input type="hidden" name="client_id" value={clientId} />
              <input type="hidden" name="project_id" value={projectId ?? ""} />
              <input type="hidden" name="return_to" value={returnTo} />
              <div className="border-b border-zinc-200 px-5 pt-4">
                <div className="flex gap-2 overflow-x-auto">
                  {tabs.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`whitespace-nowrap rounded-t-md border border-b-0 px-3 py-2 text-sm font-semibold ${
                        activeTab === tab
                          ? "border-zinc-200 bg-white text-emerald-900"
                          : "border-transparent bg-zinc-50 text-zinc-500 hover:text-zinc-800"
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                {activeTab === "Header Details" ? (
                  <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
                    <section className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
                      <h3 className="text-sm font-semibold text-zinc-950">System Numbers</h3>
                      <div className="mt-3 grid gap-3">
                        {systemFields.map(([label, value]) => (
                          <div key={label}>
                            <p className="text-xs font-semibold uppercase text-zinc-500">{label}</p>
                            <p className="mt-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700">{value}</p>
                          </div>
                        ))}
                      </div>
                      {!hasProject ? (
                        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                          Confirmed order/project will be created after client approval.
                        </p>
                      ) : null}
                    </section>
                    <section className="grid gap-4 md:grid-cols-2">
                      <Field name="client_display_name" label="Client display name" defaultValue={setup.header.clientDisplayName} />
                      <Field name="reference" label="Reference / Project Name" defaultValue={setup.header.reference} />
                      <Field name="contact_name" label="Attention / Contact" defaultValue={setup.header.contactName} />
                      <Field name="contact_phone" label="Phone" defaultValue={setup.header.contactPhone} />
                      <Field name="telephone" label="Telephone" defaultValue={setup.header.telephone} />
                      <Field name="contact_email" label="Email" defaultValue={setup.header.contactEmail} type="email" />
                      <Field name="po_box" label="PO Box" defaultValue={setup.header.poBox} />
                      <Field name="location" label="Location" defaultValue={setup.header.location} />
                      <Field name="quotation_date" label="Quotation Date" defaultValue={setup.header.quotationDate} type="date" />
                      <TextArea name="project_address" label="Project Address" defaultValue={setup.header.projectAddress} />
                    </section>
                  </div>
                ) : null}

                {activeTab === "Commercial Terms" ? (
                  <section className="grid gap-4 md:grid-cols-2">
                    <Field name="payment_terms" label="Payment Terms" defaultValue={setup.commercial.paymentTerms} />
                    <Field name="validity" label="Validity" defaultValue={setup.commercial.validity} />
                    <Field name="delivery_terms" label="Delivery Terms" defaultValue={setup.commercial.deliveryTerms} />
                    <Field name="warranty_terms" label="Warranty" defaultValue={setup.commercial.warrantyTerms} />
                    <Field name="currency" label="Currency" defaultValue={setup.commercial.currency} />
                    <Field name="vat_percent" label="VAT %" defaultValue={setup.commercial.vatPercent} type="number" />
                    <label className="block">
                      <span className="text-xs font-semibold uppercase text-zinc-500">Extra Discount Type</span>
                      <select name="overall_discount_type" defaultValue={setup.commercial.overallDiscountType} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
                        <option value="amount">Amount</option>
                        <option value="percent">Percent</option>
                      </select>
                    </label>
                    <Field name="overall_discount_value" label="Extra Discount Value" defaultValue={setup.commercial.overallDiscountValue} type="number" />
                    <TextArea name="terms_note" label="Special Commercial Notes" defaultValue={setup.notes.termsNote} className="md:col-span-2" />
                  </section>
                ) : null}

                {activeTab === "Document Visibility" ? (
                  <div className="grid gap-4 lg:grid-cols-3">
                    <VisibilityGroup title="Quotation PDF" prefix="quotation" values={setup.visibility.quotation} />
                    <VisibilityGroup title="Specification Sheet" prefix="specification" values={setup.visibility.specification} />
                    <VisibilityGroup title="Presentation" prefix="presentation" values={setup.visibility.presentation} />
                    <section className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-4 lg:col-span-3">
                      <h3 className="text-sm font-semibold text-zinc-950">Future Documents</h3>
                      <p className="mt-1 text-sm text-zinc-500">RFQ, PO, and Order Confirmation visibility settings are prepared for later workflow phases.</p>
                    </section>
                  </div>
                ) : null}

                {activeTab === "Notes & Footer" ? (
                  <section className="grid gap-4 md:grid-cols-2">
                    <TextArea name="client_intro_note" label="Client-facing introduction note" defaultValue={setup.notes.clientIntroNote} />
                    <TextArea name="client_closing_note" label="Client-facing closing note" defaultValue={setup.notes.clientClosingNote} />
                    <TextArea name="footer_note" label="Footer note" defaultValue={setup.notes.footerNote} />
                    <TextArea name="exclusion_note" label="Exclusion note" defaultValue={setup.notes.exclusionNote} />
                    <TextArea name="delivery_install_note" label="Delivery/install note" defaultValue={setup.notes.deliveryInstallNote} />
                    <TextArea name="internal_note" label="Internal note" defaultValue={setup.notes.internalNote} />
                  </section>
                ) : null}

                {activeTab === "Revision / Option Info" ? (
                  <section className="grid gap-4 md:grid-cols-2">
                    <ReadOnly label="Type" value={setup.revisionOption.type} />
                    <ReadOnly label="Revision / Option Number" value={setup.revisionOption.sequenceLabel ?? "Original"} />
                    <Field name="revision_option_reason" label="Reason / Option Title" defaultValue={setup.revisionOption.reason} />
                    <ReadOnly label="Default Text" value={setup.revisionOption.supersedesText} />
                    <TextArea name="revision_option_client_note" label="Client-facing revision/option note" defaultValue={setup.revisionOption.clientFacingNote} />
                    <TextArea name="revision_option_internal_note" label="Internal revision/option note" defaultValue={setup.revisionOption.internalNote} />
                  </section>
                ) : null}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-10 items-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                >
                  {isSaving ? "Saving setup..." : "Save Document Setup"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Field({ defaultValue, label, name, type = "text" }: { defaultValue?: string | number | null; label: string; name: string; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">{label}</span>
      <input name={name} type={type} step={type === "number" ? "0.01" : undefined} defaultValue={defaultValue ?? ""} className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10" />
    </label>
  );
}

function TextArea({ className = "", defaultValue, label, name }: { className?: string; defaultValue?: string | null; label: string; name: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs font-semibold uppercase text-zinc-500">{label}</span>
      <textarea name={name} defaultValue={defaultValue ?? ""} rows={3} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10" />
    </label>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-zinc-500">{label}</p>
      <p className="mt-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-700">{value}</p>
    </div>
  );
}

function VisibilityGroup({ prefix, title, values }: { prefix: string; title: string; values: Record<string, boolean> }) {
  return (
    <section className="rounded-md border border-zinc-200 p-4">
      <h3 className="text-sm font-semibold text-zinc-950">{title}</h3>
      <div className="mt-3 grid gap-2">
        {Object.entries(values).map(([key, value]) => (
          <label key={key} className="flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" name={`${prefix}.${key}`} defaultChecked={value} className="h-4 w-4 rounded border-zinc-300 text-emerald-900" />
            <span>{labelFromKey(key)}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

function labelFromKey(value: string) {
  return value
    .replace(/^show/, "")
    .replace(/([A-Z])/g, " $1")
    .trim();
}
