import Link from "next/link";
import { redirect } from "next/navigation";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { updateCompanySettings, updateDocumentDefaults } from "@/app/settings/actions";
import { requireActiveUser } from "@/lib/auth";
import {
  companyAddressLines,
  getCompanyProfile,
  getCompanySettingsRecord,
} from "@/lib/company-profile";
import { DEFAULT_QUOTATION_NOTES } from "@/lib/quotations/quotation-pdf-settings";
import { createAdminClient } from "@/lib/supabase/admin";

type CompanySettingsSectionProps = {
  searchParams?: Promise<{
    message?: string;
    messageScope?: string;
    messageType?: string;
  }>;
  section: "company" | "documents";
};

function Field({
  defaultValue,
  label,
  name,
  required = false,
  type = "text",
}: {
  defaultValue?: string | number | null;
  label: string;
  name: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        required={required}
        className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
    </label>
  );
}

function TextAreaField({
  defaultValue,
  label,
  name,
  rows = 10,
}: {
  defaultValue?: string | null;
  label: string;
  name: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">{label}</span>
      <textarea
        name={name}
        defaultValue={defaultValue ?? ""}
        rows={rows}
        className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-3 text-sm leading-6 text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
    </label>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not saved yet";

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export async function CompanySettingsSection({
  searchParams,
  section,
}: CompanySettingsSectionProps) {
  const { user, profile, displayName } = await requireActiveUser();
  if (profile?.role === "viewer") {
    redirect("/dashboard");
  }

  const params = (await searchParams) ?? {};
  const canManageSettings =
    profile?.role === "system_owner" ||
    profile?.role === "admin_manager" ||
    profile?.role === "procurement_manager";
  const companySettings = await getCompanySettingsRecord();
  const companyProfile = section === "company" ? await getCompanyProfile() : null;
  const updatedById = companySettings?.updated_by ?? null;
  const adminResult = createAdminClient();
  const { data: updatedByProfile } = updatedById && adminResult.client
    ? await adminResult.client
      .from("profiles")
      .select("full_name,email")
      .eq("id", updatedById)
      .maybeSingle<{ full_name: string | null; email: string | null }>()
    : { data: null };
  const lastUpdatedBy =
    updatedByProfile?.full_name?.trim() || updatedByProfile?.email?.trim() || "Unknown user";
  const showMessage = params.messageScope === "settings" && typeof params.message === "string";
  const messageClassName = params.messageType === "error"
    ? "border-red-200 bg-red-50 text-red-900"
    : "border-emerald-200 bg-emerald-50 text-emerald-950";
  const isCompany = section === "company";

  return (
    <ErpAppShell
      eyebrow="SYSTEM"
      title={isCompany ? "Company Profile" : "Document Defaults"}
      description={
        isCompany
          ? "Manage company identity and document branding details."
          : "Manage defaults used by quotation documents and exports."
      }
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <div className="mx-auto max-w-4xl px-5 py-6 sm:px-8">
        <div className="mb-5 flex items-center justify-between gap-4">
          <Link
            href="/settings"
            className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-800"
          >
            Back to settings
          </Link>
          {showMessage ? (
            <p className={`rounded-md border px-3 py-2 text-sm ${messageClassName}`}>
              {params.message}
            </p>
          ) : null}
        </div>

        {isCompany && companyProfile ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Company Profile</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                  These details appear in quotation PDFs and specification sheets when available.
                </p>
              </div>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600">
                {canManageSettings ? "Editable" : "Read only"}
              </span>
            </div>

            {canManageSettings ? (
              <form action={updateCompanySettings} className="mt-5 grid gap-4 md:grid-cols-2">
                <Field name="company_name" label="Company name" defaultValue={companySettings?.company_name} required />
                <Field name="display_name" label="Display name" defaultValue={companySettings?.display_name} />
                <Field name="address_line_1" label="Address line 1" defaultValue={companySettings?.address_line_1} />
                <Field name="address_line_2" label="Address line 2" defaultValue={companySettings?.address_line_2} />
                <Field name="city" label="City" defaultValue={companySettings?.city} />
                <Field name="country" label="Country" defaultValue={companySettings?.country} />
                <Field name="trn" label="TRN / Tax number" defaultValue={companySettings?.trn} />
                <Field name="phone" label="Phone" defaultValue={companySettings?.phone} />
                <Field name="email" label="Email" defaultValue={companySettings?.email} type="email" />
                <Field name="website" label="Website" defaultValue={companySettings?.website} />
                <Field name="default_currency" label="Default currency" defaultValue={companySettings?.default_currency ?? companyProfile.defaultCurrency} />
                <Field name="vat_percent" label="VAT percentage" defaultValue={companySettings?.vat_percent ?? companyProfile.vatPercent} type="number" />
                <div className="md:col-span-2">
                  <Field name="logo_url" label="Logo URL / logo path" defaultValue={companySettings?.logo_url} />
                </div>
                <div className="md:col-span-2 flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-6 py-4">
                  <span className="text-xs text-zinc-500">
                    Last updated: {formatDateTime(companySettings?.updated_at)}
                    {companySettings?.updated_at ? ` by ${lastUpdatedBy}` : ""}
                  </span>
                  <PendingSubmitButton
                    className="rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
                    pendingLabel="Saving company profile..."
                  >
                    Save company profile
                  </PendingSubmitButton>
                </div>
              </form>
            ) : (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-xs font-semibold uppercase text-zinc-500">Display name</p>
                  <p className="mt-2 text-sm font-medium text-zinc-950">{companyProfile.displayName}</p>
                </div>
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-xs font-semibold uppercase text-zinc-500">Company name</p>
                  <p className="mt-2 text-sm font-medium text-zinc-950">{companyProfile.companyName}</p>
                </div>
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 sm:col-span-2">
                  <p className="text-xs font-semibold uppercase text-zinc-500">Address</p>
                  <p className="mt-2 text-sm text-zinc-700">
                    {companyAddressLines(companyProfile).join(", ") || "Not set"}
                  </p>
                </div>
              </div>
            )}
          </section>
        ) : (
          <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Document Defaults</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                  Define default quotation notes used when no quotation-specific override is saved.
                </p>
              </div>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600">
                {canManageSettings ? "Editable" : "Read only"}
              </span>
            </div>

            {canManageSettings ? (
              <form action={updateDocumentDefaults} className="mt-5 grid gap-4">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                  <h3 className="text-sm font-semibold text-zinc-950">Quotation Notes</h3>
                  <p className="mt-1 text-sm text-zinc-500">
                    These notes fill quotation PDF previews and downloads by default.
                  </p>
                  <div className="mt-4">
                    <TextAreaField
                      name="default_quotation_notes"
                      label="Default quotation notes"
                      defaultValue={companySettings?.default_quotation_notes ?? DEFAULT_QUOTATION_NOTES}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-6 py-4">
                  <span className="text-xs text-zinc-500">
                    Last updated: {formatDateTime(companySettings?.updated_at)}
                    {companySettings?.updated_at ? ` by ${lastUpdatedBy}` : ""}
                  </span>
                  <PendingSubmitButton
                    className="rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
                    pendingLabel="Saving document defaults..."
                  >
                    Save document defaults
                  </PendingSubmitButton>
                </div>
              </form>
            ) : (
              <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                <h3 className="text-sm font-semibold text-zinc-950">Quotation Notes</h3>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-700">
                  {companySettings?.default_quotation_notes ?? DEFAULT_QUOTATION_NOTES}
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </ErpAppShell>
  );
}
