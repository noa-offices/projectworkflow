import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  Building2,
  ChevronRight,
  FileText,
  HardHat,
  ShieldCheck,
  UserCircle,
  Users,
  Users2,
  type LucideIcon,
} from "lucide-react";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { requireActiveUser } from "@/lib/auth";

type SettingsItemProps = {
  badge?: string;
  description: string;
  href: string;
  icon: LucideIcon;
  title: string;
};

function SettingsItem({
  badge,
  description,
  href,
  icon: Icon,
  title,
}: SettingsItemProps) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 px-5 py-4 transition hover:bg-zinc-50"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-zinc-950">{title}</h3>
          {badge ? (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
              {badge}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-zinc-500">{description}</p>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />
    </Link>
  );
}

function SettingsGroup({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
        {title}
      </h2>
      <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        {children}
      </div>
    </section>
  );
}

export default async function SettingsPage() {
  const { user, profile, displayName } = await requireActiveUser();
  if (profile?.role === "viewer") {
    redirect("/dashboard");
  }

  const canManageCompany =
    profile?.role === "system_owner" ||
    profile?.role === "admin_manager" ||
    profile?.role === "procurement_manager";
  const canManagePeople =
    profile?.role === "system_owner" || profile?.role === "admin_manager";
  const isSystemOwner = profile?.role === "system_owner";

  return (
    <ErpAppShell
      title="Settings"
      description="Manage company, people, and access settings from one place."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <div className="mx-auto grid max-w-4xl gap-7 px-5 py-6 sm:px-8">
        <SettingsGroup title="Company">
          <SettingsItem
            href="/settings/company"
            icon={Building2}
            title="Company Profile"
            description="Manage company identity, contact details, tax information, logo, and branding."
            badge={canManageCompany ? "Editable" : "Read only"}
          />
          <SettingsItem
            href="/settings/documents"
            icon={FileText}
            title="Document Defaults"
            description="Set the default notes used in quotation documents and exports."
            badge={canManageCompany ? "Editable" : "Read only"}
          />
        </SettingsGroup>

        <SettingsGroup title="People">
          <SettingsItem
            href="/settings/profile"
            icon={UserCircle}
            title="My Profile"
            description="Review and update your internal profile and contact details."
          />
          {isSystemOwner ? (
            <SettingsItem
              href="/settings/users"
              icon={Users}
              title="User Management"
              description="Approve users, assign roles, and manage account access."
            />
          ) : null}
          {canManagePeople ? (
            <>
              <SettingsItem
                href="/hr"
                icon={Users2}
                title="HR Management"
                description="Manage staff leave balances and document expiry."
              />
              <SettingsItem
                href="/settings/workers"
                icon={HardHat}
                title="Workers Directory"
                description="Manage field staff records and document expiry."
              />
            </>
          ) : null}
        </SettingsGroup>

        {isSystemOwner ? (
          <SettingsGroup title="Access & Permissions">
            <SettingsItem
              href="/settings/roles"
              icon={ShieldCheck}
              title="Role Guide"
              description="Review effective feature permissions across application roles."
            />
          </SettingsGroup>
        ) : null}
      </div>
    </ErpAppShell>
  );
}
