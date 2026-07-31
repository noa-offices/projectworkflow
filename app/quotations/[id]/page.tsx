import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { ExportExcelButton } from "@/components/quotations/export-excel-button";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { ContextBackLink } from "@/components/navigation/context-back-link";
import { PendingLinkButton } from "@/components/pending-link-button";
import { DocumentSetupDialog } from "@/components/quotations/document-setup-dialog";
import { QuotationFolderActionDialog } from "@/components/quotations/quotation-folder-action-dialog";
import { QuotationFolderForm } from "@/components/quotations/quotation-folder-form";
import { LocalDraftLink } from "@/components/quotations/local-draft-link";
import { OpportunityQuotationLinkSync } from "@/components/quotations/opportunity-quotation-link-sync";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { requireActiveUser } from "@/lib/auth";
import { defaultCurrency, normalizeCurrency, supportedCurrencies } from "@/lib/currencies";
import {
  formatQuotationDisplayNo,
  quotationOptionLabel,
  quotationRootBaseNo,
} from "@/lib/quotation-options";
import {
  quotationStatusBadgeClassName,
  quotationStatusLabel,
} from "@/lib/quotation-status";
import { formatQuotationMoney } from "@/lib/quotation-pricing";
import { quotationApprovalDisplay } from "@/lib/quotations/approval-display";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { resolveDocumentSetup } from "@/lib/quotations/document-setup";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { QuotationStatusSelector } from "@/components/quotations/quotation-status-selector";
import {
  formatConfirmedOrderNumber,
  formatOrderConfirmationNumber,
  formatPresentationNumber,
  formatPurchaseOrderNumber,
  formatSpecificationNumber,
  formatSupplierRfqNumber,
  opportunityNumberFromQuotationNumber,
  quotationFolderNumberFromQuotationNumber,
} from "@/lib/projectworkflow-numbering";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { profileDisplayName } from "@/lib/user-display";
import {
  archiveFolderQuotation,
  createProjectFileFromQuotation,
  createQuotationOption,
  createQuotationRevision,
  duplicateQuotation,
  permanentlyDeleteQuotation,
  restoreQuotation,
  updateQuotation,
  updateQuotationEnquiryDetails,
  updateQuotationExtraDiscount,
  updateQuotationSalesperson,
} from "../actions";

export const dynamic = "force-dynamic";

type QuotationDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ message?: string; tab?: string }>;
};

type QuotationFolderTab = "overview" | "quotations" | "documents" | "activity";

type Client = {
  id: string;
  client_number: string | null;
  company_name: string;
};

type Project = {
  id: string;
  project_name: string;
  project_year: number | null;
  location: string | null;
  attention_to: string | null;
  attention_mobile: string | null;
  attention_landline: string | null;
  attention_email: string | null;
  po_box: string | null;
  project_address: string | null;
};

type Quotation = {
  approved_salesperson_id: string | null;
  id: string;
  client_id: string;
  project_id: string | null;
  legacy_reference: string | null;
  quotation_no: string | null;
  option_no: number;
  revision_no: number | null;
  title: string;
  quotation_date: string;
  status: string;
  layout_mode: string;
  layout_settings: unknown;
  salesperson_id: string | null;
  currency: string;
  vat_percent: number;
  overall_discount_type: string;
  overall_discount_value: number;
  subtotal: number;
  discount_total: number;
  vat_amount: number;
  grand_total: number;
  payment_terms: string | null;
  validity: string | null;
  delivery_terms: string | null;
  warranty_terms: string | null;
  notes: string | null;
  status_note: string | null;
  status_updated_at: string | null;
  status_updated_by: string | null;
  is_active: boolean;
};

type FolderQuotation = Pick<Quotation, "id" | "quotation_no" | "option_no" | "title" | "quotation_date" | "status" | "currency" | "grand_total" | "approved_salesperson_id" | "layout_settings"> & {
  is_active?: boolean;
  revision_no: number | null;
  status_updated_at?: string | null;
};

type CopyDestinationQuotation = Pick<Quotation, "id" | "client_id" | "project_id" | "quotation_no" | "title" | "quotation_date" | "status" | "is_active">;

type CopyDestinationFolder = {
  id: string;
  label: string;
};

type QuotationItem = {
  id: string;
  quotation_id: string;
  section_id: string | null;
  item_type: string;
  manual_serial: string | null;
  item_code_snapshot: string | null;
  item_name_snapshot: string | null;
  specified_image_url_snapshot: string | null;
  proposed_image_url_snapshot: string | null;
  specification_snapshot: string | null;
  room_name_snapshot: string | null;
  model_snapshot: string | null;
  finish_snapshot: string | null;
  size_snapshot: string | null;
  origin_snapshot: string | null;
  warranty_snapshot: string | null;
  supplier_name_snapshot: string | null;
  supplier_notes_snapshot: string | null;
  qty: number;
  unit_label: string;
  unit_price: number;
  discount_type: string;
  discount_value: number;
  net_price: number;
  net_total: number;
  currency: string;
  sort_order: number;
  is_optional: boolean;
  internal_cost: number;
  margin_type: string;
  margin_value: number;
  is_rate_only: boolean;
  line_style: string;
  row_height: number | null;
  cell_layout: CellLayout | null;
  is_active: boolean;
  notes: string | null;
};

type CellLayout = {
  mergeMode?: string;
};

type SalespersonProfile = { id: string; full_name: string | null; email: string | null };

type AuditActivityEntry = {
  id: string;
  entity_type: string;
  entity_id: string | null;
  parent_entity_type: string | null;
  parent_entity_id: string | null;
  action: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
};

type GroupedActivityEntry = {
  actorName: string;
  action: string;
  count: number;
  dayKey: string;
  entries: AuditActivityEntry[];
  latestAt: string;
  summary: string;
};

function Field({
  name,
  label,
  defaultValue,
  required,
  type = "text",
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">
        {label}
      </span>
      <input
        name={name}
        type={type}
        step={type === "number" ? "0.01" : undefined}
        defaultValue={defaultValue ?? ""}
        required={required}
        className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
    </label>
  );
}

function TextArea({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
}) {
  return (
    <label className="block md:col-span-2">
      <span className="text-xs font-semibold uppercase text-zinc-500">
        {label}
      </span>
      <textarea
        name={name}
        defaultValue={defaultValue ?? ""}
        rows={2}
        className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
    </label>
  );
}

function SubmitButton({ label }: { label: string }) {
  return (
    <PendingSubmitButton
      className="h-10 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
    >
      {label}
    </PendingSubmitButton>
  );
}

function StatusBadge({
  quotation,
}: {
  quotation: Pick<Quotation, "approved_salesperson_id" | "layout_settings" | "status">;
}) {
  const approvalDisplay = quotationApprovalDisplay(quotation);

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${approvalDisplay?.badgeClassName ?? quotationStatusBadgeClassName(quotation.status)}`}>
      {approvalDisplay?.label ?? quotationStatusLabel(quotation.status)}
    </span>
  );
}

function quotationOptionDisplayLabel(quotationNo: string | null | undefined, optionNo: number | null | undefined) {
  const lastOption = quotationBranchTokens(quotationNo).filter((token) => token.type === "OPT").at(-1);
  if (lastOption) return `Option ${lastOption.sequence}`;

  if ((optionNo ?? 1) > 1) {
    return `Option ${Math.max((optionNo ?? 1) - 1, 1)}`;
  }

  return quotationOptionLabel(optionNo);
}

function OptionBadge({
  optionNo,
  quotationNo,
}: {
  optionNo: number;
  quotationNo: string | null;
}) {
  return (
    <span className="inline-flex rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700">
      {quotationOptionDisplayLabel(quotationNo, optionNo)}
    </span>
  );
}

function InfoValue({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase text-zinc-500">{label}</p>
      <p className="mt-1 break-words text-sm text-zinc-800">{value || "-"}</p>
    </div>
  );
}

function SecondaryActionLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
    >
      {label}
    </Link>
  );
}

function SecondaryPendingActionLink({
  href,
  label,
  pendingLabel,
}: {
  href: string;
  label: string;
  pendingLabel: string;
}) {
  return (
    <PendingLinkButton
      href={href}
      pendingLabel={pendingLabel}
      className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
    >
      {label}
    </PendingLinkButton>
  );
}

function DocumentActionRow({
  title,
  description,
  previewHref,
  previewLabel,
  downloadHref,
  downloadLabel,
  pendingLabel,
}: {
  title: string;
  description: string;
  previewHref: string;
  previewLabel: string;
  downloadHref: string;
  downloadLabel: string;
  pendingLabel: string;
}) {
  return (
    <div className="flex min-h-44 flex-col rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex min-w-0 items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-xs font-bold text-emerald-800" aria-hidden="true">
          {title.slice(0, 1)}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-950">{title}</h3>
          <p className="mt-1 text-sm leading-5 text-zinc-500">{description}</p>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <SecondaryActionLink href={previewHref} label={previewLabel} />
        <SecondaryPendingActionLink
          href={downloadHref}
          label={downloadLabel}
          pendingLabel={pendingLabel}
        />
      </div>
    </div>
  );
}

function FutureDocumentRow({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-zinc-950">{title}</p>
          <p className="mt-1 text-xs text-zinc-500">{description}</p>
        </div>
        <span className="inline-flex w-fit rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-500">
          Future
        </span>
      </div>
    </div>
  );
}

function DisabledWorkflowButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      disabled
      className="inline-flex h-10 cursor-not-allowed items-center rounded-md border border-zinc-200 bg-zinc-100 px-4 text-sm font-semibold text-zinc-400"
    >
      {label}
    </button>
  );
}

function HeaderActionMenu({
  children,
  label,
  mobileAlign = "right",
}: {
  children: ReactNode;
  label: string;
  mobileAlign?: "left" | "right";
}) {
  return (
    <details className="relative">
      <summary className="inline-flex h-10 w-full cursor-pointer list-none items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 sm:h-11 sm:w-auto sm:px-4">
        <span>{label}</span>
        <span aria-hidden="true">&#9662;</span>
      </summary>
      <div className={`absolute z-20 mt-2 grid w-[min(15rem,calc(100vw-2rem))] gap-2 rounded-md border border-zinc-200 bg-white p-2 shadow-lg sm:right-0 sm:w-auto sm:min-w-60 ${mobileAlign === "left" ? "left-0 sm:left-auto" : "right-0"}`}>
        {children}
      </div>
    </details>
  );
}

function FolderMutationForm({
  action,
  confirmMessage,
  label,
  pendingLabel,
  quotationId,
  returnTo,
  className,
}: {
  action: (formData: FormData) => Promise<void>;
  confirmMessage: string;
  label: string;
  pendingLabel: string;
  quotationId: string;
  returnTo: string;
  className: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="quotation_id" value={quotationId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <ConfirmSubmitButton className={className} message={confirmMessage} pendingLabel={pendingLabel}>
        {label}
      </ConfirmSubmitButton>
    </form>
  );
}

function CopyQuotationDestinationForm({
  destinationFolders,
  quotationId,
  returnTo,
}: {
  destinationFolders: CopyDestinationFolder[];
  quotationId: string;
  returnTo: string;
}) {
  return (
    <QuotationFolderActionDialog label="Copy Quotation" title="Copy Quotation">
      <form action={duplicateQuotation} className="grid gap-3">
        <input type="hidden" name="quotation_id" value={quotationId} />
        <input type="hidden" name="return_to" value={returnTo} />
        <fieldset className="grid gap-2">
          <legend className="text-xs font-semibold uppercase text-zinc-500">Copy quotation to:</legend>
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input type="radio" name="duplicate_destination_mode" value="existing_enquiry" defaultChecked />
            <span>Existing enquiry/folder</span>
          </label>
          <select
            name="destination_quotation_id"
            defaultValue=""
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          >
            <option value="">Choose destination folder</option>
            {destinationFolders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input type="radio" name="duplicate_destination_mode" value="create_new_enquiry" />
            <span>Create new enquiry</span>
          </label>
        </fieldset>
        <div>
          <ConfirmSubmitButton
            className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
            message="Copy Quotation\n\nThis will copy the selected quotation using the chosen destination."
            pendingLabel="Copying..."
          >
            Copy quotation
          </ConfirmSubmitButton>
        </div>
      </form>
    </QuotationFolderActionDialog>
  );
}

function EditEnquiryDetailsDialog({
  clients,
  quotation,
  resolvedDocumentSetup,
  salespersonProfiles,
}: {
  clients: Client[];
  quotation: Quotation;
  resolvedDocumentSetup: ReturnType<typeof resolveDocumentSetup>;
  salespersonProfiles: SalespersonProfile[];
}) {
  return (
    <QuotationFolderActionDialog label="Edit quotation folder" title="Edit quotation folder">
      <QuotationFolderForm
        action={updateQuotationEnquiryDetails}
        clients={clients}
        mode="edit"
        quotationId={quotation.id}
        returnTo={`/quotations/${quotation.id}`}
        salespersonProfiles={salespersonProfiles}
        values={{
          clientId: quotation.client_id,
          contactEmail: resolvedDocumentSetup.header.contactEmail,
          contactName: resolvedDocumentSetup.header.contactName,
          contactPhone: resolvedDocumentSetup.header.contactPhone,
          currency: quotation.currency,
          deliveryTerms: quotation.delivery_terms,
          layoutMode: quotation.layout_mode,
          location: resolvedDocumentSetup.header.location,
          notes: quotation.notes,
          paymentTerms: quotation.payment_terms,
          poBox: resolvedDocumentSetup.header.poBox,
          projectAddress: resolvedDocumentSetup.header.projectAddress,
          quotationDate: quotation.quotation_date,
          quotationNo: quotation.quotation_no,
          reference: quotation.legacy_reference ?? quotation.title,
          salespersonId: quotation.salesperson_id,
          telephone: resolvedDocumentSetup.header.telephone,
          validity: quotation.validity,
          vatPercent: quotation.vat_percent,
          warrantyTerms: quotation.warranty_terms,
        }}
      />
    </QuotationFolderActionDialog>
  );
}

function CreateProjectFileForm({
  orderNo,
  quotationId,
  returnTo,
}: {
  orderNo: string;
  quotationId: string;
  returnTo: string;
}) {
  return (
    <form action={createProjectFileFromQuotation}>
      <input type="hidden" name="quotation_id" value={quotationId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <ConfirmSubmitButton
        className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
        message={`Create Project File\n\nThis will create ${orderNo} from the client-confirmed quotation. RFQ, PO, OC, and procurement will not be created.`}
        pendingLabel="Creating..."
      >
        Create Project File
      </ConfirmSubmitButton>
    </form>
  );
}

function ArchiveFolderQuotationForm({
  quotationId,
  returnTo,
}: {
  quotationId: string;
  returnTo: string;
}) {
  async function submitArchive(formData: FormData) {
    "use server";
    await archiveFolderQuotation(formData);
  }

  return (
    <form action={submitArchive}>
      <input type="hidden" name="quotation_id" value={quotationId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <ConfirmSubmitButton
        className="inline-flex h-9 items-center rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 transition hover:border-red-700 hover:text-red-800"
        message={"Archive Quote\n\nThis will hide only the selected quotation from the active folder. Other quotations in this folder will not be changed."}
        pendingLabel="Archiving..."
      >
        Archive Quote
      </ConfirmSubmitButton>
    </form>
  );
}

function RestoreFolderQuotationForm({
  quotationId,
  returnTo,
}: {
  quotationId: string;
  returnTo: string;
}) {
  return (
    <form action={restoreQuotation}>
      <input type="hidden" name="quotation_id" value={quotationId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <PendingSubmitButton
        className="inline-flex h-9 items-center rounded-md border border-emerald-200 bg-white px-3 text-sm font-semibold text-emerald-900 transition hover:border-emerald-700 hover:text-emerald-800"
        pendingLabel="Restoring..."
      >
        Restore Quote
      </PendingSubmitButton>
    </form>
  );
}

function PermanentlyDeleteQuotationForm({
  quotationId,
  returnTo,
}: {
  quotationId: string;
  returnTo: string;
}) {
  return (
    <form action={permanentlyDeleteQuotation} className="grid gap-2 rounded-md border border-red-200 bg-red-50 p-3">
      <input type="hidden" name="quotation_id" value={quotationId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <label className="block">
        <span className="text-xs font-semibold uppercase text-red-800">Type DELETE to confirm</span>
        <input
          name="confirmText"
          autoComplete="off"
          className="mt-1 h-9 w-full rounded-md border border-red-200 bg-white px-3 text-sm outline-none transition focus:border-red-700 focus:ring-2 focus:ring-red-900/10"
        />
      </label>
      <ConfirmSubmitButton
        className="inline-flex h-9 items-center justify-center rounded-md bg-red-700 px-3 text-sm font-semibold text-white transition hover:bg-red-800"
        message={"This will permanently delete this archived quotation only. Other quotations in this folder will not be changed. Type DELETE to confirm."}
        pendingLabel="Deleting..."
      >
        Delete permanently
      </ConfirmSubmitButton>
    </form>
  );
}

function CurrencySelect({ defaultValue }: { defaultValue?: string | null }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">Currency</span>
      <select
        name="currency"
        defaultValue={normalizeCurrency(defaultValue ?? defaultCurrency)}
        className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      >
        {supportedCurrencies.map((currency) => (
          <option key={currency.code} value={currency.code}>
            {currency.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function overallDiscountAmount(quotation: Quotation) {
  const itemNetTotal = Math.max(quotation.subtotal - quotation.discount_total, 0);

  if (quotation.overall_discount_type === "percent") {
    return (itemNetTotal * quotation.overall_discount_value) / 100;
  }

  return quotation.overall_discount_value;
}

function money(currency: string, value: number) {
  return formatQuotationMoney(currency, value);
}

function validUuidOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();

  return trimmed && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

function auditMetadataActorName(metadata: Record<string, unknown> | null | undefined) {
  const actorName = metadata?.actorName;

  return typeof actorName === "string" && actorName.trim() ? actorName : null;
}

function activityActorName(actorNameById: Map<string, string>, entry: AuditActivityEntry) {
  if (entry.created_by) {
    return actorNameById.get(entry.created_by) ?? auditMetadataActorName(entry.metadata) ?? "User";
  }

  return auditMetadataActorName(entry.metadata) ?? "User";
}

function activityDayKey(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function activityDayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();

  if (activityDayKey(date.toISOString()) === activityDayKey(today.toISOString())) {
    return "Today";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(date);
}

function groupedActivitySummary({
  action,
  actorName,
  count,
}: {
  action: string;
  actorName: string;
  count: number;
}) {
  if (action === "row_price_updated" && count > 1) {
    return `${actorName} updated ${count} row prices`;
  }

  if (action === "quotation_item_added" && count > 1) {
    return `${actorName} added ${count} products to the quotation`;
  }

  if (action === "deleted" && count > 1) {
    return `${actorName} removed ${count} quotation rows`;
  }

  return null;
}

function groupActivityEntries(
  entries: AuditActivityEntry[],
  actorNameById: Map<string, string>,
) {
  const groups = new Map<string, GroupedActivityEntry>();

  for (const entry of entries) {
    const actorName = activityActorName(actorNameById, entry);
    const dayKey = activityDayKey(entry.created_at);
    const canGroup =
      entry.action === "row_price_updated" ||
      entry.action === "quotation_item_added" ||
      entry.action === "deleted";
    const groupKey = canGroup
      ? `${entry.action}:${actorName}:${dayKey}`
      : `single:${entry.id}`;
    const existingGroup = groups.get(groupKey);

    if (existingGroup) {
      existingGroup.count += 1;
      existingGroup.entries.push(entry);
      if (new Date(entry.created_at).getTime() > new Date(existingGroup.latestAt).getTime()) {
        existingGroup.latestAt = entry.created_at;
      }
      existingGroup.summary = groupedActivitySummary({
        action: existingGroup.action,
        actorName: existingGroup.actorName,
        count: existingGroup.count,
      }) ?? `${entry.title} by ${actorName}`;
      continue;
    }

    groups.set(groupKey, {
      actorName,
      action: entry.action,
      count: 1,
      dayKey,
      entries: [entry],
      latestAt: entry.created_at,
      summary: `${entry.title} by ${actorName}`,
    });
  }

  return Array.from(groups.values())
    .sort((left, right) => new Date(right.latestAt).getTime() - new Date(left.latestAt).getTime());
}

function entriesByDay<T extends { created_at?: string; latestAt?: string }>(
  entries: T[],
  getDateValue: (entry: T) => string,
) {
  const groups = new Map<string, T[]>();

  for (const entry of entries) {
    const dayKey = activityDayKey(getDateValue(entry));
    groups.set(dayKey, [...(groups.get(dayKey) ?? []), entry]);
  }

  return Array.from(groups.entries()).sort((left, right) => right[0].localeCompare(left[0]));
}

function ExtraDiscountForm({
  quotation,
  returnTo,
  compact = false,
}: {
  quotation: Quotation;
  returnTo: string;
  compact?: boolean;
}) {
  return (
    <form action={updateQuotationExtraDiscount} className={compact ? "grid gap-2" : "grid gap-3 md:grid-cols-[180px_1fr_auto]"}>
      <input type="hidden" name="id" value={quotation.id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Extra Discount Type</span>
        <select name="overall_discount_type" defaultValue={quotation.overall_discount_type} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
          <option value="amount">Amount</option>
          <option value="percent">Percent</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Extra Discount Value</span>
        <div className="mt-1 flex h-10 overflow-hidden rounded-md border border-zinc-200 bg-white focus-within:border-emerald-800 focus-within:ring-2 focus-within:ring-emerald-900/10">
          <input
            name="overall_discount_value"
            type="number"
            step="0.01"
            min="0"
            defaultValue={quotation.overall_discount_value}
            className="min-w-0 flex-1 px-3 text-sm outline-none"
          />
          <span className="flex items-center border-l border-zinc-200 bg-zinc-50 px-3 text-xs font-semibold text-zinc-500">
            {quotation.overall_discount_type === "percent" ? "%" : quotation.currency}
          </span>
        </div>
      </label>
      <div className={compact ? "" : "flex items-end"}>
        <SubmitButton label="Save extra discount" />
      </div>
    </form>
  );
}

function ReassignSalespersonForm({
  quotationId,
  currentSalespersonId,
  profiles,
}: {
  quotationId: string;
  currentSalespersonId: string | null;
  profiles: SalespersonProfile[];
}) {
  async function handleReassign(formData: FormData) {
    "use server";
    const newId = formData.get("salesperson_id") as string | null;
    await updateQuotationSalesperson(quotationId, newId || null);
  }

  return (
    <form action={handleReassign} className="mt-3">
      <div className="grid gap-2 sm:flex sm:items-end">
        <label className="block min-w-0 flex-1">
          <span className="text-xs font-semibold uppercase text-zinc-500">Reassign Sales Manager</span>
          <select
            name="salesperson_id"
            defaultValue={currentSalespersonId ?? ""}
            required
            className="mt-1 h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          >
            <option value="">Select Sales Manager</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name ?? p.email ?? p.id}
              </option>
            ))}
          </select>
        </label>
        <PendingSubmitButton
          className="h-9 w-full shrink-0 rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 sm:w-auto"
          pendingLabel="Saving…"
        >
          Save
        </PendingSubmitButton>
      </div>
      <p className="mt-1.5 text-xs text-zinc-500">
        Applies to every quotation, revision, option, and copy in this folder.
      </p>
    </form>
  );
}

function QuotationTermsForm({ quotation, mode }: { quotation: Quotation; mode: "details" | "terms" }) {
  const isDetails = mode === "details";

  return (
    <form action={updateQuotation} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="id" value={quotation.id} />
      <input type="hidden" name="client_id" value={quotation.client_id} />
      <input type="hidden" name="project_id" value={quotation.project_id ?? ""} />
      <input type="hidden" name="legacy_reference" value={quotation.legacy_reference ?? ""} />
      <input type="hidden" name="is_active" value={quotation.is_active ? "on" : ""} />
      <input type="hidden" name="audit_scope" value={isDetails ? "details" : "terms"} />
      {isDetails ? (
        <>
          <input type="hidden" name="currency" value={quotation.currency} />
          <input type="hidden" name="vat_percent" value={quotation.vat_percent} />
          <input type="hidden" name="overall_discount_type" value={quotation.overall_discount_type} />
          <input type="hidden" name="overall_discount_value" value={quotation.overall_discount_value} />
          <input type="hidden" name="payment_terms" value={quotation.payment_terms ?? ""} />
          <input type="hidden" name="validity" value={quotation.validity ?? ""} />
          <input type="hidden" name="delivery_terms" value={quotation.delivery_terms ?? ""} />
          <input type="hidden" name="warranty_terms" value={quotation.warranty_terms ?? ""} />
          <input type="hidden" name="notes" value={quotation.notes ?? ""} />
          <input type="hidden" name="quotation_no" value={quotation.quotation_no ?? ""} />
          <input type="hidden" name="status" value={quotation.status} />
          <input type="hidden" name="layout_mode" value={quotation.layout_mode} />
          <Field name="title" label="Title" defaultValue={quotation.title} required />
          <Field name="quotation_date" label="Quotation date" type="date" defaultValue={quotation.quotation_date} />
        </>
      ) : (
        <>
          <input type="hidden" name="title" value={quotation.title} />
          <input type="hidden" name="quotation_no" value={quotation.quotation_no ?? ""} />
          <input type="hidden" name="quotation_date" value={quotation.quotation_date} />
          <input type="hidden" name="status" value={quotation.status} />
          <input type="hidden" name="layout_mode" value={quotation.layout_mode} />
          <Field name="payment_terms" label="Payment terms" defaultValue={quotation.payment_terms} />
          <Field name="validity" label="Validity" defaultValue={quotation.validity} />
          <Field name="delivery_terms" label="Delivery terms" defaultValue={quotation.delivery_terms} />
          <Field name="warranty_terms" label="Warranty terms" defaultValue={quotation.warranty_terms} />
          <CurrencySelect defaultValue={quotation.currency} />
          <Field name="vat_percent" label="VAT %" type="number" defaultValue={quotation.vat_percent} />
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Extra Discount Type</span>
            <select name="overall_discount_type" defaultValue={quotation.overall_discount_type} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
              <option value="amount">Amount</option>
              <option value="percent">Percent</option>
            </select>
          </label>
          <Field
            name="overall_discount_value"
            label="Extra Discount Value"
            type="number"
            defaultValue={quotation.overall_discount_value}
          />
          <TextArea name="notes" label="Notes" defaultValue={quotation.notes} />
        </>
      )}
      <div className="flex justify-end md:col-span-2">
        <SubmitButton label={isDetails ? "Save quote details" : "Save commercial terms"} />
      </div>
    </form>
  );
}

export default async function QuotationDetailPage({
  params,
  searchParams,
}: QuotationDetailPageProps) {
  const { id } = await params;
  const { user, profile, displayName } = await requireActiveUser();
  const resolvedSearchParams = await searchParams;
  const message = resolvedSearchParams?.message;
  const requestedTab = resolvedSearchParams?.tab;
  const activeTab: QuotationFolderTab =
    requestedTab === "quotations" || requestedTab === "documents" || requestedTab === "activity"
      ? requestedTab
      : "overview";
  const tabClassName = (tab: QuotationFolderTab) =>
    `min-w-0 px-1 pb-2 text-center text-xs transition sm:pb-3 sm:text-sm ${
      activeTab === tab
        ? "border-b-2 border-emerald-800 text-emerald-900"
        : "hover:text-emerald-900"
    }`;
  const canManageRecords =
    profile?.role === "system_owner" ||
    profile?.role === "admin_manager" ||
    profile?.role === "procurement_manager" ||
    profile?.role === "sales_designer" ||
    profile?.role === "sales_coordinator" ||
    profile?.role === "designer";
  const canUseQuotationActions =
    profile?.role === "system_owner" ||
    profile?.role === "admin_manager" ||
    profile?.role === "procurement_manager" ||
    profile?.role === "sales_designer" ||
    profile?.role === "sales_coordinator" ||
    profile?.role === "designer";
  const supabase = await createSupabaseClient();

  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("*")
    .eq("id", id)
    .single<Quotation>();

  if (quotationError || !quotation) {
    notFound();
  }

  const { data: client } = await supabase
    .from("clients")
    .select("id,client_number,company_name")
    .eq("id", quotation.client_id)
    .single<Client>();

  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("id,client_number,company_name")
    .order("company_name", { ascending: true })
    .returns<Client[]>();

  const safeProjectId = validUuidOrNull(quotation.project_id);
  const { data: project } = safeProjectId
    ? await supabase
        .from("projects")
        .select("id,project_name,project_year,location,attention_to,attention_mobile,attention_landline,attention_email,po_box,project_address")
        .eq("id", safeProjectId)
        .single<Project>()
    : { data: null };

  const rootBaseNo = quotationRootBaseNo(quotation.quotation_no);
  const { data: projectQuotations, error: projectQuotationsError } = safeProjectId
    ? await supabase
        .from("quotations")
        .select("id,quotation_no,option_no")
        .eq("project_id", safeProjectId)
        .eq("is_active", true)
        .returns<Array<{ id: string; quotation_no: string | null; option_no: number }>>()
    : { data: [], error: null };

  const { data: folderQuotations, error: folderQuotationsError } = safeProjectId
    ? await supabase
        .from("quotations")
        .select("id,quotation_no,option_no,revision_no,title,quotation_date,status,status_updated_at,currency,grand_total,is_active,approved_salesperson_id,layout_settings")
        .eq("project_id", safeProjectId)
        .order("quotation_date", { ascending: false })
        .returns<FolderQuotation[]>()
    : rootBaseNo
      ? await supabase
          .from("quotations")
          .select("id,quotation_no,option_no,revision_no,title,quotation_date,status,status_updated_at,currency,grand_total,is_active,approved_salesperson_id,layout_settings")
          .ilike("quotation_no", `${rootBaseNo}%`)
          .order("quotation_date", { ascending: false })
          .returns<FolderQuotation[]>()
      : { data: null, error: null };

  const { data: copyDestinationQuotations, error: copyDestinationQuotationsError } = await supabase
    .from("quotations")
    .select("id,client_id,project_id,quotation_no,title,quotation_date,status,is_active")
    .eq("is_active", true)
    .neq("id", quotation.id)
    .order("quotation_date", { ascending: false })
    .limit(200)
    .returns<CopyDestinationQuotation[]>();

  const { data: items, error: itemsError } = await supabase
    .from("quotation_items")
    .select(
      "id,quotation_id,section_id,item_type,manual_serial,item_code_snapshot,item_name_snapshot,specified_image_url_snapshot,proposed_image_url_snapshot,specification_snapshot,room_name_snapshot,model_snapshot,finish_snapshot,size_snapshot,origin_snapshot,warranty_snapshot,supplier_name_snapshot,supplier_notes_snapshot,qty,unit_label,unit_price,discount_type,discount_value,net_price,net_total,currency,sort_order,is_optional,internal_cost,margin_type,margin_value,is_rate_only,line_style,row_height,cell_layout,is_active,notes",
    )
    .eq("quotation_id", id)
    .order("section_id", { ascending: true, nullsFirst: true })
    .order("sort_order", { ascending: true })
    .returns<QuotationItem[]>();

  const { data: quotationEvents, error: quotationEventsError } = await supabase
    .from("audit_activity_log")
    .select("id,entity_type,entity_id,parent_entity_type,parent_entity_id,action,title,description,metadata,created_by,created_at")
    .eq("entity_type", "quotation")
    .eq("entity_id", id)
    .order("created_at", { ascending: false })
    .limit(10)
    .returns<AuditActivityEntry[]>();

  const { data: quotationChildEvents, error: quotationChildEventsError } = await supabase
    .from("audit_activity_log")
    .select("id,entity_type,entity_id,parent_entity_type,parent_entity_id,action,title,description,metadata,created_by,created_at")
    .eq("parent_entity_type", "quotation")
    .eq("parent_entity_id", id)
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<AuditActivityEntry[]>();

  if (clientsError) console.error("QUOTATION CLIENTS LIST ERROR", clientsError.message);
  if (itemsError) console.error("QUOTATION ITEMS LIST ERROR", itemsError.message);
  if (projectQuotationsError) console.error("PROJECT QUOTATIONS OPTION LIST ERROR", projectQuotationsError.message);
  if (folderQuotationsError) console.error("QUOTATION FOLDER LIST ERROR", folderQuotationsError.message);
  if (copyDestinationQuotationsError) console.error("COPY DESTINATION QUOTATIONS LIST ERROR", copyDestinationQuotationsError.message);
  if (quotationEventsError) console.error("QUOTATION ACTIVITY LOG ERROR", quotationEventsError.message);
  if (quotationChildEventsError) console.error("QUOTATION CHILD ACTIVITY LOG ERROR", quotationChildEventsError.message);

  const resolvedDocumentSetup = resolveDocumentSetup({
    client,
    project,
    quotation,
  });
  const optionCountCandidates = projectQuotations?.length
    ? projectQuotations
    : (folderQuotations ?? []).map((candidate) => ({
        id: candidate.id,
        option_no: candidate.option_no,
        quotation_no: candidate.quotation_no,
      }));
  const optionCountForRootBase = rootBaseNo
    ? Math.max(
        1,
        ...optionCountCandidates
          .filter((candidate) => quotationRootBaseNo(candidate.quotation_no) === rootBaseNo)
          .map((candidate) => candidate.option_no ?? 1),
      )
    : 1;
  const showOptionNumber = optionCountForRootBase > 1;
  const displayQuotationNo = formatQuotationDisplayNo({
    optionNo: quotation.option_no,
    quotationNo: quotation.quotation_no,
    showOptionNumber,
  });
  const quotationFolderNo = quotationFolderNumberFromQuotationNumber(quotation.quotation_no);
  const derivedOpportunityNo = opportunityNumberFromQuotationNumber(quotation.quotation_no);
  const folderDisplayNo = quotationFolderNo ?? "Not prepared";
  const folderDisplayReference = resolvedDocumentSetup.header.reference;
  const folderTitle = folderDisplayReference || quotation.title?.trim() || "Quotation folder";
  const folderQuotationList = (folderQuotations?.length ? folderQuotations : [quotation as FolderQuotation])
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.id === entry.id) === index)
    .sort((left, right) => {
      const leftActive = left.is_active !== false;
      const rightActive = right.is_active !== false;
      if (leftActive !== rightActive) return leftActive ? -1 : 1;

      const leftSort = quotationBranchSortKey(left.quotation_no);
      const rightSort = quotationBranchSortKey(right.quotation_no);
      if (leftSort !== rightSort) return leftSort.localeCompare(rightSort);

      const leftDate = new Date(left.quotation_date).getTime();
      const rightDate = new Date(right.quotation_date).getTime();
      if (leftDate !== rightDate) return rightDate - leftDate;

      return (left.quotation_no ?? "").localeCompare(right.quotation_no ?? "");
  });
  const activeFolderQuotations = folderQuotationList.filter((entry) => !isArchivedFolderQuotation(entry));
  const archivedFolderQuotations = folderQuotationList.filter((entry) => isArchivedFolderQuotation(entry));
  const currentDestinationFolderKey = quotationDestinationFolderKey(quotation);
  const copyDestinationFolders = Array.from(
    new Map(
      (copyDestinationQuotations ?? [])
        .filter((candidate) => !isArchivedFolderQuotation(candidate))
        .map((candidate): [string, CopyDestinationFolder] | null => {
          const key = quotationDestinationFolderKey(candidate);
          if (!key || key === currentDestinationFolderKey) return null;

          const folderNo = quotationFolderNumberFromQuotationNumber(candidate.quotation_no);
          const label = folderNo
            ? `${folderNo} - ${candidate.title}`
            : `${candidate.title} - ${formatFolderDate(candidate.quotation_date)}`;

          return [key, { id: candidate.id, label }];
        })
        .filter((entry): entry is [string, CopyDestinationFolder] => Boolean(entry)),
    ).values(),
  );
  const activeFolderQuotationCount = activeFolderQuotations.length;
  const archivedFolderQuotationCount = archivedFolderQuotations.length;
  const specificationNo = quotation.quotation_no ? formatSpecificationNumber(quotation.quotation_no) : null;
  const presentationNo = quotation.quotation_no ? formatPresentationNumber(quotation.quotation_no) : null;
  const workflowSequences = quotationWorkflowSequences(quotation.quotation_no);
  const confirmedOrderNo = workflowSequences
    ? formatConfirmedOrderNumber(workflowSequences.clientSequence, workflowSequences.opportunitySequence)
    : null;
  const supplierRfqNo = confirmedOrderNo ? formatSupplierRfqNumber(confirmedOrderNo, 1) : null;
  const purchaseOrderNo = confirmedOrderNo ? formatPurchaseOrderNumber(confirmedOrderNo, 1) : null;
  const orderConfirmationNo = confirmedOrderNo ? formatOrderConfirmationNumber(confirmedOrderNo) : null;
  const currentQuotationArchived = isArchivedFolderQuotation(quotation);
  const currentClientApprovalDraft = clientApprovalDraftFromLayoutSettings(quotation.layout_settings);
  const currentProjectFile =
    projectFileFromLayoutSettings(quotation.layout_settings) ??
    currentClientApprovalDraft?.confirmedOrder ??
    null;
  const currentApprovalDisplay = quotationApprovalDisplay(quotation);
  const workflowReturnTo = `/quotations/${quotation.id}`;
  const projectFileNo = currentProjectFile?.orderNo ?? confirmedOrderNo ?? "CO pending";
  console.log("[DEBUG canCreateProjectFile]", {
    quotation_no: quotation.quotation_no,
    workflowSequences: Boolean(workflowSequences),
    status: quotation.status,
    canManageRecords,
    currentProjectFile: Boolean(currentProjectFile),
  });
  const canCreateProjectFile =
    canManageRecords &&
    !currentProjectFile &&
    Boolean(workflowSequences) &&
    !currentQuotationArchived &&
    currentApprovalDisplay?.state === "project_file_pending";
  const projectFileBlockedReason = currentApprovalDisplay?.state === "project_file_pending" && !workflowSequences
    ? "Prepare this older quotation before creating a Project File."
    : null;
  const folderWorkflowHelper = currentProjectFile
    ? currentApprovalDisplay?.state === "owner_attribution_pending"
      ? `Project File ${currentProjectFile.orderNo} exists, but approved Sales Manager attribution is pending.`
      : `Project File ${currentProjectFile.orderNo} has been created from this approved quotation.`
    : currentApprovalDisplay?.state === "project_file_pending"
      ? "Client confirmed. Create the Project File when ready."
      : "Send quotation documents manually, then update the selected quotation status when the client replies.";

  const activityEntries = Array.from(
    new Map(
      [...(quotationEvents ?? []), ...(quotationChildEvents ?? [])].map((entry) => [entry.id, entry]),
    ).values(),
  )
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .slice(0, 20);
  const activityActorIds = Array.from(new Set(
    [quotation.status_updated_by, ...activityEntries.map((entry) => entry.created_by)]
      .filter((value): value is string => Boolean(value)),
  ));
  const activityActorNameById = new Map<string, string>();

  if (activityActorIds.length) {
    const { data: activityProfiles, error: activityProfilesError } = await supabase
      .from("profiles")
      .select("id,full_name,email")
      .in("id", activityActorIds)
      .returns<Array<{ id: string; full_name: string | null; email: string | null }>>();

    if (activityProfilesError) {
      console.warn("QUOTATION ACTIVITY PROFILES ERROR", activityProfilesError.message);
    } else {
      for (const profile of activityProfiles ?? []) {
        activityActorNameById.set(profile.id, profileDisplayName(profile));
      }
    }
  }

  const groupedActivityEntries = groupActivityEntries(activityEntries, activityActorNameById).slice(0, 5);
  const groupedActivityByDay = entriesByDay(groupedActivityEntries, (entry) => entry.latestAt);
  const fullActivityByDay = entriesByDay(activityEntries, (entry) => entry.created_at);

  // Salesperson attribution
  const canReassignSalesperson = canUseQuotationActions;

  let salespersonName: string | null = null;
  let salespersonProfiles: SalespersonProfile[] = [];

  if (quotation.salesperson_id) {
    const { data: spProfile } = await supabase
      .from("profiles")
      .select("id,full_name,email")
      .eq("id", quotation.salesperson_id)
      .maybeSingle<SalespersonProfile>();
    salespersonName = spProfile ? (spProfile.full_name ?? spProfile.email ?? null) : null;
  }

  if (canUseQuotationActions) {
    const adminResult = createAdminClient();

    if (adminResult.client) {
      const { data: spProfiles } = await adminResult.client
        .from("profiles")
        .select("id,full_name,email")
        .eq("role", "sales_designer")
        .eq("account_status", "active")
        .order("full_name", { ascending: true })
        .returns<SalespersonProfile[]>();
      salespersonProfiles = spProfiles ?? [];
    }
  }

  const itemCurrencies = new Set(
    (items ?? [])
      .filter((item) => item.is_active)
      .map((item) => normalizeCurrency(item.currency)),
  );
  const hasMixedCurrencies =
    itemCurrencies.size > 1 ||
    (itemCurrencies.size === 1 && !itemCurrencies.has(normalizeCurrency(quotation.currency)));
  const activeItemCount = (items ?? []).filter((item) =>
    item.is_active &&
    !["note", "blank", "subtotal"].includes(item.item_type) &&
    !["heading", "note", "no_quote"].includes(item.line_style),
  ).length;
  const recentFolderQuotations = [...folderQuotationList]
    .sort((left, right) => new Date(right.quotation_date).getTime() - new Date(left.quotation_date).getTime())
    .slice(0, 3);
  const latestOverviewActivity = groupedActivityEntries[0] ?? null;
  const hasFolderBranches = folderQuotationList.some((folderQuotation) =>
    quotationBranchTokens(folderQuotation.quotation_no).length > 0 || (folderQuotation.option_no ?? 1) > 1,
  );
  const workflowStages = ["Draft", "Sent to Client", "Client Confirmed", "Project File"];
  const workflowStageIndex = currentProjectFile
    ? 3
    : quotation.status === "client_confirmed" || currentApprovalDisplay?.state === "project_file_pending"
      ? 2
      : quotation.status === "sent_to_client"
        ? 1
        : 0;

  return (
    <ErpAppShell
      eyebrow="SALES"
      title="Quotation Folder"
      description="Sales file for quotation building, documents, approvals, and future order confirmation."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
        <OpportunityQuotationLinkSync />
        <div className="px-4 py-4 sm:px-8 sm:py-6 xl:grid xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-x-5">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between xl:col-span-2">
            <ContextBackLink
              fallbackHref="/sales/quotations"
              className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-800"
            >
              Back to Quotations
            </ContextBackLink>
            {message ? (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                {message}
              </p>
            ) : null}
          </div>

          <section className="grid gap-5 xl:contents">
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 xl:col-start-1 xl:row-start-2">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <p className="text-sm font-semibold text-zinc-500">
                    {quotationFolderNo ?? "Not prepared for client workflow"}
                  </p>
                  <h1 className="mt-1 text-xl font-semibold leading-tight text-zinc-950 sm:text-2xl">
                    {folderTitle}
                  </h1>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {showOptionNumber ? <OptionBadge optionNo={quotation.option_no} quotationNo={quotation.quotation_no} /> : null}
                    <StatusBadge quotation={quotation} />
                    <LocalDraftLink quotationId={quotation.id} showLink={false} />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 sm:hidden">
                    <span className="text-xs font-semibold uppercase text-zinc-500">Current total</span>
                    <span className="min-w-0 break-words text-right text-lg font-semibold text-zinc-950">
                      {money(quotation.currency, quotation.grand_total)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-3 xl:items-end">
                  <div className="grid grid-cols-2 gap-2 [&>*]:w-full sm:flex sm:flex-wrap sm:[&>*]:w-auto">
                    {currentQuotationArchived ? (
                      <span className="inline-flex h-10 cursor-not-allowed items-center justify-center rounded-md border border-zinc-200 bg-zinc-100 px-3 text-sm font-semibold text-zinc-400 sm:h-11 sm:px-5" title="Restore this quote before editing.">
                        Open Builder
                      </span>
                    ) : (
                      <Link
                        href={`/quotations/${quotation.id}/local-builder`}
                        className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-3 text-sm font-semibold text-white transition hover:bg-emerald-800 sm:h-11 sm:px-5"
                      >
                        Open Builder
                      </Link>
                    )}
                    <SecondaryActionLink href={`/quotations/${quotation.id}/pdf`} label="Preview Quotation" />
                    <HeaderActionMenu label="Documents" mobileAlign="left">
                      <SecondaryPendingActionLink
                        href={`/quotations/${quotation.id}/download-pdf`}
                        label="Download Quotation PDF"
                        pendingLabel="Preparing PDF..."
                      />
                      <ExportExcelButton quotationId={quotation.id} />
                      <DocumentSetupDialog
                        clientId={quotation.client_id}
                        hasProject={resolvedDocumentSetup.header.hasConfirmedProject}
                        projectId={safeProjectId}
                        quotationId={quotation.id}
                        returnTo={`/quotations/${quotation.id}`}
                        setup={resolvedDocumentSetup}
                        triggerClassName="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
                      />
                    </HeaderActionMenu>
                    <HeaderActionMenu label="Actions">
                      {canUseQuotationActions && !currentQuotationArchived ? (
                        <EditEnquiryDetailsDialog
                          clients={clients ?? (client ? [client] : [])}
                          quotation={quotation}
                          resolvedDocumentSetup={resolvedDocumentSetup}
                          salespersonProfiles={salespersonProfiles}
                        />
                      ) : (
                        <DisabledWorkflowButton label="Edit enquiry details" />
                      )}
                      {canManageRecords ? (
                        <QuotationFolderActionDialog label="Edit quote details" title="Edit quote details">
                          <QuotationTermsForm quotation={quotation} mode="details" />
                        </QuotationFolderActionDialog>
                      ) : null}
                      {canManageRecords ? (
                        <QuotationFolderActionDialog label="Edit commercial terms" title="Edit commercial terms">
                          <QuotationTermsForm quotation={quotation} mode="terms" />
                        </QuotationFolderActionDialog>
                      ) : null}
                      {canUseQuotationActions && !currentQuotationArchived ? (
                        <FolderMutationForm
                          action={createQuotationRevision}
                          className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
                          confirmMessage={"Create Revision\n\nThis will copy the current quotation into a new revision. The original quotation will remain unchanged."}
                          label="Create Revision"
                          pendingLabel="Creating revision..."
                          quotationId={quotation.id}
                          returnTo={`/quotations/${quotation.id}`}
                        />
                      ) : (
                        <DisabledWorkflowButton label="Create Revision" />
                      )}
                      {canUseQuotationActions && !currentQuotationArchived ? (
                        <FolderMutationForm
                          action={createQuotationOption}
                          className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
                          confirmMessage={"Create Option\n\nThis will copy the current quotation into a new option quotation. Use options for alternate brands, materials, or scope. The original quotation will remain unchanged."}
                          label="Create Option"
                          pendingLabel="Creating option..."
                          quotationId={quotation.id}
                          returnTo={`/quotations/${quotation.id}`}
                        />
                      ) : (
                        <DisabledWorkflowButton label="Create Option" />
                      )}
                      {canUseQuotationActions && !currentQuotationArchived ? (
                        <CopyQuotationDestinationForm
                          destinationFolders={copyDestinationFolders}
                          quotationId={quotation.id}
                          returnTo={`/quotations/${quotation.id}`}
                        />
                      ) : (
                        <DisabledWorkflowButton label="Copy Quotation" />
                      )}
                    </HeaderActionMenu>
                  </div>
                  {activeTab !== "overview" ? (
                    <p className="text-xs text-zinc-500">{folderWorkflowHelper}</p>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50/40 sm:mt-5 sm:grid-cols-2 xl:grid-cols-3">
                <div className="border-r border-zinc-200 p-3 sm:border-b sm:p-4">
                  <InfoValue label="Client" value={resolvedDocumentSetup.header.clientDisplayName} />
                </div>
                <div className="p-3 sm:border-b sm:p-4 xl:border-r">
                  <p className="text-xs font-semibold uppercase text-zinc-500">Sales Person</p>
                  <p className="mt-1 truncate text-sm font-medium text-zinc-800">{salespersonName ?? "Unassigned"}</p>
                  {canReassignSalesperson ? (
                    <>
                      <div className="mt-2 sm:hidden">
                        <QuotationFolderActionDialog label="Reassign" title="Reassign Sales Manager">
                          <ReassignSalespersonForm
                            quotationId={quotation.id}
                            currentSalespersonId={quotation.salesperson_id}
                            profiles={salespersonProfiles}
                          />
                        </QuotationFolderActionDialog>
                      </div>
                      <div className="hidden sm:block">
                        <ReassignSalespersonForm
                          quotationId={quotation.id}
                          currentSalespersonId={quotation.salesperson_id}
                          profiles={salespersonProfiles}
                        />
                      </div>
                    </>
                  ) : null}
                </div>
                <div className="hidden border-b border-zinc-200 p-4 sm:block sm:border-r xl:border-r">
                  <InfoValue label="Opportunity no" value={derivedOpportunityNo ?? "Not linked"} />
                </div>
                <div className="hidden border-b border-zinc-200 p-4 sm:block xl:border-b-0 xl:border-r">
                  <InfoValue label="Quotation folder" value={folderDisplayNo} />
                </div>
                <div className="hidden border-b border-zinc-200 p-4 sm:block sm:border-b-0 sm:border-r">
                  <InfoValue label="Date" value={formatFolderDate(quotation.quotation_date)} />
                </div>
                <div className="hidden p-4 sm:block">
                  <InfoValue label="Current quotation" value={displayQuotationNo ?? quotation.quotation_no ?? "Draft quotation"} />
                </div>
              </div>

              <nav className="mt-4 grid grid-cols-4 gap-1 border-b border-zinc-200 font-semibold text-zinc-500 sm:mt-5 sm:flex sm:gap-6 sm:overflow-x-auto" aria-label="Quotation folder sections">
                <Link href={`/quotations/${quotation.id}?tab=overview`} className={tabClassName("overview")}>Overview</Link>
                <Link href={`/quotations/${quotation.id}?tab=quotations`} className={tabClassName("quotations")}>
                  <span className="sm:hidden">Quotes</span>
                  <span className="hidden sm:inline">Quotations in Folder</span>
                </Link>
                <Link href={`/quotations/${quotation.id}?tab=documents`} className={tabClassName("documents")}>Documents</Link>
                <Link href={`/quotations/${quotation.id}?tab=activity`} className={tabClassName("activity")}>Activity</Link>
              </nav>

              {activeTab === "overview" ? (
              <details className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50/60 p-3 sm:mt-5 sm:p-4">
                <summary className="cursor-pointer list-none">
                  <span className="block text-sm font-semibold text-zinc-950">Workflow progress</span>
                  <span className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:items-center sm:overflow-x-auto sm:pb-1">
                    {workflowStages.map((stage, index) => (
                      <span key={stage} className="flex min-w-0 items-center gap-2 sm:shrink-0">
                        <span
                          aria-current={index === workflowStageIndex ? "step" : undefined}
                          className={`inline-flex h-8 min-w-0 flex-1 items-center justify-center rounded-full border px-2 text-center text-xs font-semibold sm:flex-none sm:px-3 ${
                            index === workflowStageIndex
                              ? "border-emerald-800 bg-emerald-900 text-white"
                              : index < workflowStageIndex
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : "border-zinc-200 bg-white text-zinc-500"
                          }`}
                        >
                          {stage}
                        </span>
                        {index < workflowStages.length - 1 ? <span className="hidden text-zinc-300 sm:inline" aria-hidden="true">&rarr;</span> : null}
                      </span>
                    ))}
                  </span>
                </summary>
                <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <article className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-zinc-950">Quotation Status</h2>
                    </div>
                    <StatusBadge quotation={quotation} />
                  </div>
                  {quotation.status_note ? (
                    <p className="mt-3 text-sm text-zinc-600">Note: {quotation.status_note}</p>
                  ) : null}
                  {canUseQuotationActions ? (
                    <>
                      <QuotationStatusSelector quotationId={quotation.id} currentStatus={quotation.status} />
                      {quotation.status === "on_hold" ? (
                        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950">
                          This quotation is currently on hold. No actions will be taken until the status changes.
                        </p>
                      ) : null}
                      {quotation.status === "cancelled" ? (
                        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-900">
                          This quotation has been rejected or lost. The folder is closed.
                        </p>
                      ) : null}
                      {quotation.status === "revision_required" ? (
                        <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900">
                          Client has requested changes — create a revision below.
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </article>

                <article className="rounded-lg border border-emerald-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-zinc-950">Project File</h2>
                      <p className="mt-1 text-sm text-zinc-500">
                        {currentProjectFile
                          ? currentApprovalDisplay?.state === "owner_attribution_pending"
                            ? `Project File ${currentProjectFile.orderNo} exists, but approved Sales Manager attribution is pending.`
                            : `Project File ${currentProjectFile.orderNo} has been created from this approved quotation.`
                          : currentApprovalDisplay?.state === "project_file_pending"
                            ? "Create the Project File from this client-confirmed quotation."
                            : "Available after the selected quotation is Client Confirmed."}
                      </p>
                    </div>
                    {currentProjectFile ? (
                      <Link
                        href={`/projects/orders/${currentProjectFile.orderNo}`}
                        className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
                      >
                        Open Project File
                      </Link>
                    ) : canCreateProjectFile ? (
                      <CreateProjectFileForm
                        orderNo={projectFileNo}
                        quotationId={quotation.id}
                        returnTo={workflowReturnTo}
                      />
                    ) : (
                      <DisabledWorkflowButton label="Create Project File" />
                    )}
                  </div>
                  {projectFileBlockedReason ? (
                    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950">
                      {projectFileBlockedReason}
                    </p>
                  ) : null}
                  <dl className="mt-4 grid gap-3 text-sm">
                    <InfoValue label="Project file no" value={currentProjectFile?.orderNo ?? projectFileNo} />
                    <InfoValue label="Source quotation" value={quotation.quotation_no ?? "Older quotation"} />
                  </dl>
                </article>
                </section>
              </details>
              ) : null}
              {activeTab === "overview" ? (
                <div className="mt-4 grid gap-4">
                  <section className="grid grid-cols-3 overflow-hidden rounded-lg border border-zinc-200 bg-white">
                    <div className="min-w-0 border-r border-zinc-200 p-3 sm:p-4">
                      <InfoValue label="Quotations" value={folderQuotationList.length} />
                    </div>
                    <div className="min-w-0 border-r border-zinc-200 p-3 sm:p-4">
                      <InfoValue label="Active items" value={activeItemCount} />
                    </div>
                    <div className="min-w-0 p-3 sm:p-4">
                      <InfoValue label="Final total" value={money(quotation.currency, quotation.grand_total)} />
                    </div>
                  </section>

                  <section className="rounded-lg border border-zinc-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-sm font-semibold text-zinc-950">Latest activity</h2>
                      <Link href={`/quotations/${quotation.id}?tab=activity`} className="text-xs font-semibold text-emerald-900">View activity</Link>
                    </div>
                    {canManageRecords && latestOverviewActivity ? (
                      <div className="mt-3 flex flex-col gap-1 text-sm text-zinc-700 sm:flex-row sm:items-center sm:justify-between">
                        <p>{latestOverviewActivity.summary}</p>
                        <p className="shrink-0 text-xs text-zinc-500">{formatFolderDate(latestOverviewActivity.latestAt)}</p>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-zinc-500">{canManageRecords ? "No activity recorded yet." : "Activity is available to quotation record managers."}</p>
                    )}
                  </section>

                  {hasFolderBranches ? (
                    <section className="rounded-lg border border-zinc-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-sm font-semibold text-zinc-950">Recent quotations</h2>
                        <Link href={`/quotations/${quotation.id}?tab=quotations`} className="text-xs font-semibold text-emerald-900">View all</Link>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {recentFolderQuotations.map((folderQuotation) => (
                          <Link key={folderQuotation.id} href={`/quotations/${folderQuotation.id}`} className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900">
                            {folderQuotation.quotation_no ?? "Older quotation"}
                          </Link>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              ) : null}
              {activeTab === "quotations" ? (
              <>
              <section className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50/60 p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-zinc-950">Quotations in this folder</h2>
                    <p className="mt-1 text-sm text-zinc-500">Original quotation, revisions, and options stay grouped under one folder.</p>
                  </div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {activeFolderQuotationCount} active · {archivedFolderQuotationCount} archived
                  </p>
                </div>
                {!activeFolderQuotations.length ? (
                  <p className="mt-4 rounded-md border border-dashed border-zinc-200 bg-white p-4 text-sm text-zinc-500">
                    No active quotations in this folder.
                  </p>
                ) : null}
                {activeFolderQuotationCount === 1 ? (
                  <p className="mt-3 text-xs text-zinc-500 sm:hidden">
                    Keep at least one active quotation in this folder.
                  </p>
                ) : null}
                <div className="mt-4 grid gap-3">
                  {activeFolderQuotations.map((folderQuotation) => {
                    const isCurrentFolderQuotation = folderQuotation.id === quotation.id;
                    const tokens = quotationBranchTokens(folderQuotation.quotation_no);
                    const folderTypeLabel = tokens.length
                      ? tokens.map((token) => token.type === "OPT" ? `Option ${token.sequence}` : `Revision ${token.sequence}`).join(" / ")
                      : (folderQuotation.option_no ?? 1) > 1
                        ? `Option ${Math.max((folderQuotation.option_no ?? 1) - 1, 1)}`
                        : "Original";
                    const cardReturnTo = `/quotations/${folderQuotation.id}`;
                    const archiveDisabledReason = activeFolderQuotationCount <= 1
                      ? "Keep at least one active quotation in this folder."
                      : null;

                    return (
                      <article
                        key={folderQuotation.id}
                        className={`rounded-lg border px-3 py-3 shadow-sm sm:px-4 sm:py-4 ${
                          isCurrentFolderQuotation
                            ? "border-emerald-300 bg-emerald-50/50"
                            : "border-zinc-200 bg-white"
                        }`}
                      >
                        <div className="sm:hidden">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="inline-flex rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700">
                              {folderTypeLabel}
                            </span>
                            {isCurrentFolderQuotation ? (
                              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900">
                                Current
                              </span>
                            ) : null}
                            <StatusBadge quotation={folderQuotation} />
                          </div>
                          <h3 className="mt-2 truncate text-base font-semibold text-zinc-950">
                            {folderQuotation.quotation_no ?? "Older quotation"}
                          </h3>
                          <p className="mt-0.5 text-sm text-zinc-500">{formatFolderDate(folderQuotation.quotation_date)}</p>
                          <p className="mt-2 break-words text-lg font-semibold text-zinc-950">
                            {money(folderQuotation.currency, folderQuotation.grand_total)}
                          </p>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <Link href={`/quotations/${folderQuotation.id}`} className="inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800">
                              Open
                            </Link>
                            <HeaderActionMenu label="More">
                              <Link href={`/quotations/${folderQuotation.id}/local-builder`} className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                                Open Builder
                              </Link>
                              <SecondaryActionLink href={`/quotations/${folderQuotation.id}/pdf`} label="Preview Quotation" />
                              <SecondaryPendingActionLink href={`/quotations/${folderQuotation.id}/download-pdf`} label="Download PDF" pendingLabel="Preparing PDF..." />
                              {canUseQuotationActions ? (
                                <>
                                  <FolderMutationForm
                                    action={createQuotationRevision}
                                    className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
                                    confirmMessage={"Create Revision\n\nThis will copy this selected folder card into a new revision. The selected parent quotation will remain unchanged."}
                                    label="Create Revision"
                                    pendingLabel="Creating revision..."
                                    quotationId={folderQuotation.id}
                                    returnTo={cardReturnTo}
                                  />
                                  <FolderMutationForm
                                    action={createQuotationOption}
                                    className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
                                    confirmMessage={"Create Option\n\nThis will copy this selected folder card into a new option quotation. Use options for alternate brands, materials, or scope. The selected parent quotation will remain unchanged."}
                                    label="Create Option"
                                    pendingLabel="Creating option..."
                                    quotationId={folderQuotation.id}
                                    returnTo={cardReturnTo}
                                  />
                                  <CopyQuotationDestinationForm
                                    destinationFolders={copyDestinationFolders}
                                    quotationId={folderQuotation.id}
                                    returnTo={cardReturnTo}
                                  />
                                </>
                              ) : null}
                              {canManageRecords && !archiveDisabledReason ? (
                                <ArchiveFolderQuotationForm quotationId={folderQuotation.id} returnTo={cardReturnTo} />
                              ) : null}
                            </HeaderActionMenu>
                          </div>
                        </div>
                        <div className="hidden sm:block">
                        <Link
                          href={`/quotations/${folderQuotation.id}`}
                          className={`block rounded-md px-1 py-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-800/20 ${
                            isCurrentFolderQuotation ? "hover:bg-emerald-100/50" : "hover:bg-zinc-50"
                          }`}
                          aria-label={`Open ${folderQuotation.quotation_no ?? "legacy quotation"}`}
                        >
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="inline-flex rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700">
                                    {folderTypeLabel}
                                  </span>
                                  <StatusBadge quotation={folderQuotation} />
                                  {isCurrentFolderQuotation ? (
                                    <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900">
                                      Current
                                    </span>
                                  ) : null}
                                </div>
                                <h3 className="mt-2 text-base font-semibold text-zinc-950">
                                  {folderQuotation.quotation_no ?? "Older quotation"}
                                </h3>
                                <p className="mt-1 text-sm text-zinc-500">{formatFolderDate(folderQuotation.quotation_date)}</p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-xs font-semibold uppercase text-zinc-500">Total</p>
                              <p className="mt-1 text-lg font-semibold text-zinc-950">
                                {money(folderQuotation.currency, folderQuotation.grand_total)}
                              </p>
                            </div>
                          </div>
                        </Link>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Link href={`/quotations/${folderQuotation.id}`} className="inline-flex h-9 items-center rounded-md bg-emerald-900 px-3 text-sm font-semibold text-white transition hover:bg-emerald-800">
                            Open Folder
                          </Link>
                          <Link href={`/quotations/${folderQuotation.id}/local-builder`} className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                            Open Builder
                          </Link>
                          <SecondaryActionLink href={`/quotations/${folderQuotation.id}/pdf`} label="Preview Quotation" />
                          <SecondaryPendingActionLink href={`/quotations/${folderQuotation.id}/download-pdf`} label="Download PDF" pendingLabel="Preparing PDF..." />
                          <details className="relative">
                            <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                              More actions
                            </summary>
                            <div className="absolute right-0 z-20 mt-2 grid min-w-52 gap-2 rounded-md border border-zinc-200 bg-white p-2 shadow-lg">
                              {canUseQuotationActions ? (
                                <FolderMutationForm
                                  action={createQuotationRevision}
                                  className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
                                  confirmMessage={"Create Revision\n\nThis will copy this selected folder card into a new revision. The selected parent quotation will remain unchanged."}
                                  label="Create Revision"
                                  pendingLabel="Creating revision..."
                                  quotationId={folderQuotation.id}
                                  returnTo={cardReturnTo}
                                />
                              ) : (
                                <span className="inline-flex h-9 cursor-not-allowed items-center rounded-md border border-zinc-200 bg-zinc-100 px-3 text-sm font-semibold text-zinc-400">Create Revision</span>
                              )}
                              {canUseQuotationActions ? (
                                <FolderMutationForm
                                  action={createQuotationOption}
                                  className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
                                  confirmMessage={"Create Option\n\nThis will copy this selected folder card into a new option quotation. Use options for alternate brands, materials, or scope. The selected parent quotation will remain unchanged."}
                                  label="Create Option"
                                  pendingLabel="Creating option..."
                                  quotationId={folderQuotation.id}
                                  returnTo={cardReturnTo}
                                />
                              ) : (
                                <span className="inline-flex h-9 cursor-not-allowed items-center rounded-md border border-zinc-200 bg-zinc-100 px-3 text-sm font-semibold text-zinc-400">Create Option</span>
                              )}
                              {canManageRecords && !archiveDisabledReason ? (
                                <ArchiveFolderQuotationForm quotationId={folderQuotation.id} returnTo={cardReturnTo} />
                              ) : (
                                <span className="inline-flex h-9 cursor-not-allowed items-center rounded-md border border-zinc-200 bg-zinc-100 px-3 text-sm font-semibold text-zinc-400" title={archiveDisabledReason ?? "Only record managers can archive quotations."}>Archive Quote</span>
                              )}
                            </div>
                          </details>
                        </div>
                        {archiveDisabledReason ? (
                          <p className="mt-2 text-xs text-zinc-500">{archiveDisabledReason}</p>
                        ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
              {archivedFolderQuotationCount ? (
                <section className="mt-4 rounded-lg border border-zinc-200 bg-white p-4">
                  <details>
                    <summary className="cursor-pointer list-none">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <h2 className="text-lg font-semibold text-zinc-950">Archived quotations</h2>
                          <p className="mt-1 text-sm text-zinc-500">
                            Archived revisions and options are hidden from the active working list.
                          </p>
                        </div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                          {archivedFolderQuotationCount} archived
                        </p>
                      </div>
                    </summary>
                    <div className="mt-4 grid gap-3">
                      {archivedFolderQuotations.map((folderQuotation) => {
                        const isCurrentFolderQuotation = folderQuotation.id === quotation.id;
                        const tokens = quotationBranchTokens(folderQuotation.quotation_no);
                        const folderTypeLabel = tokens.length
                          ? tokens.map((token) => token.type === "OPT" ? `Option ${token.sequence}` : `Revision ${token.sequence}`).join(" / ")
                          : (folderQuotation.option_no ?? 1) > 1
                            ? `Option ${Math.max((folderQuotation.option_no ?? 1) - 1, 1)}`
                            : "Original";
                        const cardReturnTo = `/quotations/${folderQuotation.id}`;
                        const deleteReturnTo = currentQuotationArchived ? cardReturnTo : `/quotations/${quotation.id}`;
                        return (
                          <article
                            key={folderQuotation.id}
                            className={`rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-3 shadow-sm sm:px-4 sm:py-4 ${
                              isCurrentFolderQuotation ? "ring-2 ring-emerald-200" : ""
                            }`}
                          >
                            <div className="sm:hidden">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="inline-flex rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700">
                                  {folderTypeLabel}
                                </span>
                                <span className="inline-flex rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-600">
                                  Archived
                                </span>
                                {isCurrentFolderQuotation ? (
                                  <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900">
                                    Current
                                  </span>
                                ) : null}
                                <StatusBadge quotation={folderQuotation} />
                              </div>
                              <h3 className="mt-2 truncate text-base font-semibold text-zinc-700">
                                {folderQuotation.quotation_no ?? "Older quotation"}
                              </h3>
                              <p className="mt-0.5 text-sm text-zinc-500">{formatFolderDate(folderQuotation.quotation_date)}</p>
                              <p className="mt-2 break-words text-lg font-semibold text-zinc-800">
                                {money(folderQuotation.currency, folderQuotation.grand_total)}
                              </p>
                              <div className="mt-3 flex items-center justify-between gap-3">
                                <Link href={`/quotations/${folderQuotation.id}`} className="inline-flex h-10 items-center rounded-md bg-zinc-800 px-4 text-sm font-semibold text-white transition hover:bg-zinc-700">
                                  Open
                                </Link>
                                <HeaderActionMenu label="More">
                                  <SecondaryActionLink href={`/quotations/${folderQuotation.id}/pdf`} label="Preview" />
                                  <SecondaryPendingActionLink href={`/quotations/${folderQuotation.id}/download-pdf`} label="Download PDF" pendingLabel="Preparing PDF..." />
                                  {canManageRecords ? (
                                    <>
                                      <RestoreFolderQuotationForm quotationId={folderQuotation.id} returnTo={cardReturnTo} />
                                      <PermanentlyDeleteQuotationForm quotationId={folderQuotation.id} returnTo={deleteReturnTo} />
                                    </>
                                  ) : null}
                                </HeaderActionMenu>
                              </div>
                            </div>
                            <div className="hidden sm:block">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="inline-flex rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700">
                                    {folderTypeLabel}
                                  </span>
                                  <span className="inline-flex rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-600">
                                    Archived
                                  </span>
                                  <StatusBadge quotation={folderQuotation} />
                                  {isCurrentFolderQuotation ? (
                                    <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900">
                                      Current
                                    </span>
                                  ) : null}
                                </div>
                                <h3 className="mt-2 text-base font-semibold text-zinc-700">
                                  {folderQuotation.quotation_no ?? "Older quotation"}
                                </h3>
                                <p className="mt-1 text-sm text-zinc-500">
                                  Archived {formatFolderDate(folderQuotation.status_updated_at ?? folderQuotation.quotation_date)}
                                </p>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="text-xs font-semibold uppercase text-zinc-500">Total</p>
                                <p className="mt-1 text-lg font-semibold text-zinc-800">
                                  {money(folderQuotation.currency, folderQuotation.grand_total)}
                                </p>
                              </div>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                              <Link href={`/quotations/${folderQuotation.id}`} className="inline-flex h-9 items-center rounded-md bg-zinc-800 px-3 text-sm font-semibold text-white transition hover:bg-zinc-700">
                                Open Folder
                              </Link>
                              <SecondaryActionLink href={`/quotations/${folderQuotation.id}/pdf`} label="Preview" />
                              <SecondaryPendingActionLink href={`/quotations/${folderQuotation.id}/download-pdf`} label="Download PDF" pendingLabel="Preparing PDF..." />
                              <span className="inline-flex h-9 cursor-not-allowed items-center rounded-md border border-zinc-200 bg-zinc-100 px-3 text-sm font-semibold text-zinc-400" title="Restore this quote before editing.">
                                Open Builder
                              </span>
                              {canManageRecords ? (
                                <RestoreFolderQuotationForm quotationId={folderQuotation.id} returnTo={cardReturnTo} />
                              ) : null}
                            </div>
                            {canManageRecords ? (
                              <div className="mt-3">
                                <PermanentlyDeleteQuotationForm quotationId={folderQuotation.id} returnTo={deleteReturnTo} />
                              </div>
                            ) : null}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </details>
                </section>
              ) : null}
              </>
              ) : null}
              {activeTab === "documents" ? (
              <section className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50/60 p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-zinc-950">Documents & Exports</h2>
                    <p className="mt-1 text-sm text-zinc-500">
                      Preview, edit, and download quotation documents from one place.
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  <DocumentActionRow
                    title={`Quotation${quotation.quotation_no ? ` - ${quotation.quotation_no}` : ""}`}
                    description="Client-facing commercial quotation."
                    previewHref={`/quotations/${quotation.id}/pdf`}
                    previewLabel="Preview"
                    downloadHref={`/quotations/${quotation.id}/download-pdf`}
                    downloadLabel="Download PDF"
                    pendingLabel="Preparing PDF..."
                  />
                  <DocumentActionRow
                    title={`Specification Sheet${specificationNo ? ` - ${specificationNo}` : ""}`}
                    description="Technical product specification."
                    previewHref={`/quotations/${id}/specification`}
                    previewLabel="Preview"
                    downloadHref={`/quotations/${quotation.id}/download-specification`}
                    downloadLabel="Download PDF"
                    pendingLabel="Preparing Specification..."
                  />
                  <DocumentActionRow
                    title={`Presentation${presentationNo ? ` - ${presentationNo}` : ""}`}
                    description="Visual client presentation."
                    previewHref={`/quotations/${quotation.id}/presentation`}
                    previewLabel="Preview"
                    downloadHref={`/quotations/${quotation.id}/download-presentation`}
                    downloadLabel="Download PDF"
                    pendingLabel="Preparing Presentation..."
                  />
                  {currentProjectFile ? (
                    <>
                      <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-zinc-950">
                            Project File - {currentProjectFile.orderNo}
                          </h3>
                          <p className="mt-1 text-sm text-zinc-500">
                            Created from this approved quotation.
                          </p>
                        </div>
                        <SecondaryActionLink href={`/projects/orders/${currentProjectFile.orderNo}`} label="Open Project File" />
                      </div>
                      <FutureDocumentRow
                        title={`Supplier RFQ${supplierRfqNo ? ` - ${supplierRfqNo}` : ""}`}
                        description="Available after Project File creation in a future phase."
                      />
                      <FutureDocumentRow
                        title={`Purchase Order${purchaseOrderNo ? ` - ${purchaseOrderNo}` : ""}`}
                        description="Future procurement document."
                      />
                      <FutureDocumentRow
                        title={`Order Confirmation${orderConfirmationNo ? ` - ${orderConfirmationNo}` : ""}`}
                        description="Future client order document."
                      />
                    </>
                  ) : null}
                </div>
              </section>
              ) : null}

            </div>

            <aside className="hidden rounded-xl border border-zinc-200 bg-white p-5 shadow-sm sm:block xl:sticky xl:top-6 xl:col-start-2 xl:row-span-6 xl:row-start-2 xl:self-start">
              <h2 className="text-base font-semibold text-zinc-950">Summary</h2>
              {hasMixedCurrencies ? (
                <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                  Currency conversion is not enabled yet. Mixed-currency totals should be reviewed manually.
                </p>
              ) : null}
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">Total Price</span>
                  <span className="font-medium text-zinc-950">{money(quotation.currency, quotation.subtotal)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">Item Discount</span>
                  <span className="font-medium text-red-700">{money(quotation.currency, quotation.discount_total)}</span>
                </div>
                {Number(overallDiscountAmount(quotation) || 0) > 0 ? (
                  <div className="flex justify-between gap-4">
                    <span className="text-zinc-500">Extra Discount</span>
                    <span className="font-medium text-zinc-950">{money(quotation.currency, overallDiscountAmount(quotation))}</span>
                  </div>
                ) : null}
                {canManageRecords ? (
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                    <ExtraDiscountForm quotation={quotation} returnTo={`/quotations/${quotation.id}`} compact />
                  </div>
                ) : null}
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">VAT {quotation.vat_percent}%</span>
                  <span className="font-medium text-zinc-950">{money(quotation.currency, quotation.vat_amount)}</span>
                </div>
                <div className="rounded-lg bg-emerald-50 p-4">
                  <p className="text-xs font-semibold uppercase text-zinc-500">Final Total</p>
                  <p className="mt-1 text-2xl font-semibold text-zinc-950">
                    {money(quotation.currency, quotation.grand_total)}
                  </p>
                </div>
              </div>
            </aside>
          </section>

          {activeTab === "activity" ? canManageRecords ? (
            <section className="mt-5 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm xl:col-start-1">
              <details open data-state-key={`quotation-activity-${quotation.id}`}>
                <summary className="cursor-pointer text-lg font-semibold text-zinc-950">
                  Quotation Activity
                </summary>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="mt-1 text-sm text-zinc-500">
                    Latest internal quotation history.
                  </p>
                </div>
              </div>
              {groupedActivityEntries.length ? (
                <div className="mt-4 space-y-4">
                  {groupedActivityByDay.map(([dayKey, entries]) => (
                    <div key={dayKey}>
                      <p className="text-xs font-semibold uppercase text-zinc-500">
                        {activityDayLabel(entries[0].latestAt)}
                      </p>
                      <ul className="mt-2 space-y-2">
                        {entries.map((entry) => (
                          <li key={`${entry.action}-${entry.latestAt}`} className="text-sm text-zinc-700">
                            <span className="mr-2 text-zinc-400">•</span>
                            {entry.summary}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <details
                    className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2"
                    data-state-key={`quotation-activity-log-${quotation.id}`}
                  >
                    <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                      View full activity log
                    </summary>
                    <div className="mt-3 space-y-4">
                      {fullActivityByDay.map(([dayKey, entries]) => (
                        <div key={dayKey}>
                          <p className="text-xs font-semibold uppercase text-zinc-500">
                            {activityDayLabel(entries[0].created_at)}
                          </p>
                          <ul className="mt-2 space-y-2">
                            {entries.map((entry) => (
                              <li key={entry.id} className="text-sm text-zinc-700">
                                <span className="mr-2 text-zinc-400">•</span>
                                <span className="font-medium text-zinc-950">
                                  {entry.title} by {activityActorName(activityActorNameById, entry)}
                                </span>
                                <span className="ml-2 text-xs text-zinc-500">
                                  {new Intl.DateTimeFormat("en-US", {
                                    dateStyle: "medium",
                                    timeStyle: "short",
                                  }).format(new Date(entry.created_at))}
                                </span>
                                {entry.description ? (
                                  <span className="block pl-4 text-xs text-zinc-500">{entry.description}</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              ) : (
                <p className="mt-4 text-sm text-zinc-500">No activity recorded yet.</p>
              )}
              </details>
            </section>
          ) : (
            <section className="mt-5 rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-500 shadow-sm xl:col-start-1">
              Activity is available to quotation record managers.
            </section>
          ) : null}

        </div>
    </ErpAppShell>
  );
}

function quotationBranchTokens(quotationNo: string | null | undefined) {
  return Array.from(quotationNo?.trim().matchAll(/-(R|OPT)(\d+)/gi) ?? [])
    .map((match) => ({ type: match[1].toUpperCase() as "R" | "OPT", sequence: Number(match[2]) }))
    .filter((token) => Number.isFinite(token.sequence));
}

function isArchivedFolderQuotation(quotation: Pick<FolderQuotation, "is_active" | "status">) {
  return quotation.is_active === false || quotation.status === "archived";
}

function quotationDestinationFolderKey(quotation: Pick<Quotation, "id" | "project_id" | "quotation_no">) {
  if (quotation.project_id) return `project:${quotation.project_id}`;

  const rootBaseNo = quotationRootBaseNo(quotation.quotation_no);
  if (rootBaseNo) return `root:${rootBaseNo}`;

  return `quotation:${quotation.id}`;
}

function quotationBranchSortKey(quotationNo: string | null | undefined) {
  const root = quotationNo?.trim().match(/^(QN-\d{4}-\d{3})/i)?.[1] ?? quotationNo ?? "";
  const suffix = quotationBranchTokens(quotationNo)
    .map((token) => `${token.type === "OPT" ? "1" : "2"}-${String(token.sequence).padStart(4, "0")}`)
    .join("/");

  return `${root}/${suffix}`;
}

function quotationWorkflowSequences(quotationNo: string | null | undefined) {
  const match = quotationNo?.trim().match(/^QN-(\d{4})-(\d{3})(?:-(?:R\d+|OPT\d+))*$/i);
  if (!match) return null;

  return {
    clientSequence: Number(match[1]),
    opportunitySequence: Number(match[2]),
  };
}

function formatFolderDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
}
