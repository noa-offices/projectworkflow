import { PendingSubmitButton } from "@/components/pending-submit-button";
import { defaultCurrency, normalizeCurrency, supportedCurrencies } from "@/lib/currencies";

export type QuotationFolderFormClient = { id: string; company_name: string };

export type QuotationFolderFormSalesperson = {
  id: string;
  email?: string | null;
  full_name: string | null;
};

export type QuotationFolderFormValues = {
  clientId?: string | null;
  contactEmail?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  currency?: string | null;
  deliveryTerms?: string | null;
  layoutMode?: string | null;
  location?: string | null;
  notes?: string | null;
  paymentTerms?: string | null;
  poBox?: string | null;
  projectAddress?: string | null;
  quotationDate?: string | null;
  quotationNo?: string | null;
  reference?: string | null;
  salespersonId?: string | null;
  telephone?: string | null;
  validity?: string | null;
  vatPercent?: number | null;
  warrantyTerms?: string | null;
};

const layoutModes = [
  ["simple_proposal", "Simple Proposal"],
  ["standard_proposal", "Standard Proposal"],
  ["comparison", "Comparison"],
  ["boq_schedule", "BOQ / Schedule"],
  ["internal_costing", "Internal Costing"],
] as const;

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
      <span className="text-xs font-semibold uppercase text-zinc-500">{label}</span>
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
      <span className="text-xs font-semibold uppercase text-zinc-500">{label}</span>
      <textarea
        name={name}
        defaultValue={defaultValue ?? ""}
        rows={2}
        className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
    </label>
  );
}

export function QuotationFolderForm({
  action,
  clients,
  currentUserId,
  mode,
  quotationId,
  returnTo,
  salespersonProfiles,
  values,
}: {
  action: (formData: FormData) => Promise<void>;
  clients: QuotationFolderFormClient[];
  currentUserId?: string;
  mode: "create" | "edit";
  quotationId?: string;
  returnTo: string;
  salespersonProfiles: QuotationFolderFormSalesperson[];
  values?: QuotationFolderFormValues;
}) {
  const requestedSalespersonId = values?.salespersonId ?? currentUserId ?? "";
  const selectedSalespersonId = mode === "create"
    ? (salespersonProfiles.some((profile) => profile.id === requestedSalespersonId)
      ? requestedSalespersonId
      : "")
    : (values?.salespersonId ?? "");

  return (
    <form action={action} data-quotation-create-form={mode === "create" ? true : undefined} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {quotationId ? <input type="hidden" name="id" value={quotationId} /> : null}
      <input type="hidden" name="return_to" value={returnTo} />
      <input type="hidden" name="project_id" value="" />
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Client</span>
        <select
          name="client_id"
          required
          defaultValue={values?.clientId ?? ""}
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        >
          <option value="">Select client</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.company_name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Sales Person</span>
        <select
          name="salesperson_id"
          required={mode === "create"}
          defaultValue={selectedSalespersonId}
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        >
          <option value="">{mode === "create" ? "Select Sales Manager" : "Unassigned"}</option>
          {salespersonProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name ?? p.email ?? p.id}
            </option>
          ))}
        </select>
      </label>
      <Field name="legacy_reference" label="Project / Reference Name" defaultValue={values?.reference} required />
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Quotation No.</span>
        <input
          value={mode === "create" ? "Generated automatically" : (values?.quotationNo ?? "Generated automatically")}
          readOnly
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-500 outline-none"
        />
      </label>
      <Field name="contact_name" label="Attention / Contact" defaultValue={values?.contactName} />
      <Field name="contact_phone" label="Phone / Mobile" defaultValue={values?.contactPhone} />
      <Field name="contact_email" label="Email" type="email" defaultValue={values?.contactEmail} />
      <Field name="telephone" label="Telephone" defaultValue={values?.telephone} />
      <Field name="po_box" label="PO Box" defaultValue={values?.poBox} />
      <Field name="location" label="Location" defaultValue={values?.location} />
      <TextArea name="project_address" label="Project Address" defaultValue={values?.projectAddress} />
      <Field
        name="quotation_date"
        label="Quotation date"
        type="date"
        defaultValue={values?.quotationDate ?? new Date().toISOString().slice(0, 10)}
      />
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Layout Mode</span>
        <select
          name="layout_mode"
          defaultValue={values?.layoutMode ?? "standard_proposal"}
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        >
          {layoutModes.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Currency</span>
        <select
          name="currency"
          defaultValue={normalizeCurrency(values?.currency ?? defaultCurrency)}
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        >
          {supportedCurrencies.map((currency) => (
            <option key={currency.code} value={currency.code}>
              {currency.label}
            </option>
          ))}
        </select>
      </label>
      <Field name="vat_percent" label="VAT %" type="number" defaultValue={values?.vatPercent ?? 5} />
      <Field name="payment_terms" label="Payment terms" defaultValue={values?.paymentTerms} />
      <Field name="validity" label="Validity" defaultValue={values?.validity} />
      <Field name="delivery_terms" label="Delivery terms" defaultValue={values?.deliveryTerms} />
      <Field name="warranty_terms" label="Warranty terms" defaultValue={values?.warrantyTerms} />
      <TextArea name="notes" label="Notes" defaultValue={values?.notes} />
      {mode === "create" ? (
        <>
          <input type="hidden" name="status" value="draft" />
          <input type="hidden" name="is_active" value="on" />
        </>
      ) : null}
      <div className="flex justify-end md:col-span-2 xl:col-span-3">
        <PendingSubmitButton
          className="h-10 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          pendingLabel={mode === "create" ? "Creating quotation..." : "Saving details..."}
        >
          {mode === "create" ? "Add quotation" : "Save enquiry details"}
        </PendingSubmitButton>
      </div>
    </form>
  );
}
