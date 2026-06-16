import Link from "next/link";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { resetTestData, updateCompanySettings, updateDocumentDefaults } from "@/app/settings/actions";
import { requireActiveUser } from "@/lib/auth";
import { getCompanyProfile, getCompanySettingsRecord, companyAddressLines } from "@/lib/company-profile";
import { DEFAULT_QUOTATION_NOTES } from "@/lib/quotations/quotation-pdf-settings";
import { createClient } from "@/lib/supabase/server";

type SettingsPageProps = {
  searchParams?: Promise<{
    message?: string;
    messageScope?: string;
    messageType?: string;
  }>;
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
  required = false,
  rows = 10,
}: {
  defaultValue?: string | null;
  label: string;
  name: string;
  required?: boolean;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">{label}</span>
      <textarea
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
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

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const { user, profile, displayName } = await requireActiveUser();
  const params = (await searchParams) ?? {};
  const canManageSettings =
    profile?.role === "system_owner" || profile?.role === "admin_manager";
  const companyProfile = await getCompanyProfile();
  const companySettings = await getCompanySettingsRecord();
  const supabase = await createClient();
  const updatedById = companySettings?.updated_by ?? null;
  const { data: updatedByProfile } = updatedById
    ? await supabase
      .from("profiles")
      .select("full_name,email")
      .eq("id", updatedById)
      .maybeSingle<{ full_name: string | null; email: string | null }>()
    : { data: null };
  const lastUpdatedBy =
    updatedByProfile?.full_name?.trim() || updatedByProfile?.email?.trim() || "Unknown user";
  const showMessage = params.messageScope !== "profile" && typeof params.message === "string";
  const messageClassName = params.messageType === "error"
    ? "border-red-200 bg-red-50 text-red-900"
    : "border-emerald-200 bg-emerald-50 text-emerald-950";

  return (
    <ErpAppShell
      title="Settings"
      description="Manage company profile metadata used across quotation and specification documents."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
    >
      <div className="px-5 py-6 sm:px-8">
          {showMessage ? (
            <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${messageClassName}`}>
              {params.message}
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
            <div className="grid gap-4">
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
                  <div className="md:col-span-2 flex items-center justify-between gap-4 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
                    <span>
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

            <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-950">Document Defaults</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                    Define default quotation notes that apply to PDFs unless a quotation-specific PDF override is saved.
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
                      These notes fill quotation PDF previews and downloads by default when no quotation-specific override is saved.
                    </p>
                    <div className="mt-4">
                      <TextAreaField
                        name="default_quotation_notes"
                        label="Default quotation notes"
                        defaultValue={companySettings?.default_quotation_notes ?? DEFAULT_QUOTATION_NOTES}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
                    <span>
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
            </div>

            <div className="grid gap-4">
              <Link
                href="/settings/profile"
                className="group rounded-lg border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-emerald-900/25 hover:shadow-md"
              >
                <div className="flex h-full flex-col justify-between gap-6">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-950">My Profile</h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-500">
                      Review your account details and keep your internal profile information current.
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-emerald-900 transition group-hover:text-emerald-800">
                    Open profile
                  </span>
                </div>
              </Link>

              {profile?.role === "system_owner" ? (
                <Link
                  href="/settings/users"
                  className="group rounded-lg border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-emerald-900/25 hover:shadow-md"
                >
                  <div className="flex h-full flex-col justify-between gap-6">
                    <div>
                      <h2 className="text-base font-semibold text-zinc-950">User Management</h2>
                      <p className="mt-2 text-sm leading-6 text-zinc-500">
                        Approve users and manage account roles.
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-emerald-900 transition group-hover:text-emerald-800">
                      Open settings
                    </span>
                  </div>
                </Link>
              ) : null}

              <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold text-zinc-950">Document Preview</h2>
                <dl className="mt-4 grid gap-3 text-sm">
                  <div>
                    <dt className="text-xs font-semibold uppercase text-zinc-500">Company name</dt>
                    <dd className="mt-1 text-zinc-900">{companyProfile.companyName}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase text-zinc-500">Address</dt>
                    <dd className="mt-1 text-zinc-700">{companyAddressLines(companyProfile).join(" / ") || "Not set"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase text-zinc-500">TRN</dt>
                    <dd className="mt-1 text-zinc-700">{companyProfile.trn ?? "Not set"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase text-zinc-500">Currency / VAT</dt>
                    <dd className="mt-1 text-zinc-700">
                      {companyProfile.defaultCurrency} / {companyProfile.vatPercent}%
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold text-zinc-950">Available Settings Areas</h2>
                <div className="mt-4 grid gap-4 text-sm">
                  <div>
                    <p className="text-xs font-semibold uppercase text-zinc-500">Current</p>
                    <ul className="mt-2 space-y-1 text-zinc-700">
                      <li>Company Profile metadata for quotation and specification documents</li>
                      <li>My Profile for internal user details and contact metadata</li>
                      <li>User Management for account approval and role control</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-zinc-500">Planned</p>
                    <ul className="mt-2 space-y-1 text-zinc-700">
                      <li>PDF and document defaults</li>
                      <li>Currency and VAT rules</li>
                      <li>Numbering formats</li>
                      <li>Role permission refinements</li>
                      <li>Order and PO settings later</li>
                    </ul>
                  </div>
                </div>
              </section>

              {profile?.role === "system_owner" && process.env.NODE_ENV !== "production" ? (
                <section className="rounded-lg border border-red-200 bg-white p-5 shadow-sm">
                  <h2 className="text-base font-semibold text-zinc-950">Danger Zone</h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">
                    Reset test data in non-production. This deletes projects, linked quotations,
                    quotation items, quotation sections, presentation/RFQ/PO/order confirmation settings,
                    and linked audit rows. It does not delete clients, product templates, brands,
                    materials, company settings, or users.
                  </p>
                  <form action={resetTestData} className="mt-4 grid gap-3">
                    <label className="block">
                      <span className="text-xs font-semibold uppercase text-zinc-500">
                        Type RESET TEST DATA
                      </span>
                      <input
                        name="confirmation_text"
                        className="mt-1 h-10 w-full rounded-md border border-red-200 px-3 text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/10"
                      />
                    </label>
                    <div className="flex justify-end">
                      <PendingSubmitButton
                        className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
                        pendingLabel="Resetting test data..."
                      >
                        Reset test data
                      </PendingSubmitButton>
                    </div>
                  </form>
                </section>
              ) : null}
            </div>
          </div>
      </div>
    </ErpAppShell>
  );
}
