import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { updateCompanySettings } from "@/app/settings/actions";
import { requireActiveUser } from "@/lib/auth";
import { getCompanyProfile, getCompanySettingsRecord, companyAddressLines } from "@/lib/company-profile";
import { createClient } from "@/lib/supabase/server";

type SettingsPageProps = {
  searchParams?: Promise<{ message?: string }>;
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

  return (
    <div className="min-h-screen bg-stone-50 lg:flex">
      <AppSidebar />
      <div className="flex-1">
        <TopBar
          title="Settings"
          description="Manage company profile metadata used across quotation and specification documents."
          userDisplayName={displayName}
          userEmail={user.email}
        />
        <main className="px-5 py-6 sm:px-8">
          {params.message ? (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
              {params.message}
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
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
                    <button
                      type="submit"
                      className="rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
                    >
                      Save company profile
                    </button>
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

            <div className="grid gap-4">
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
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
