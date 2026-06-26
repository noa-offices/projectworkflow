import type { ReactNode } from "react";
import { ErpSidebar } from "@/components/layout/erp-sidebar";
import { ErpTopbar } from "@/components/layout/erp-topbar";
import type { AppRole } from "@/lib/supabase/types";

type ErpAppShellProps = {
  children: ReactNode;
  description: string;
  eyebrow?: string;
  isCompletedProject?: boolean;
  role?: AppRole | null;
  title: string;
  userAvatarUrl?: string | null;
  userDisplayName?: string;
  userEmail?: string | null;
  userRole?: AppRole | null;
};

export function ErpAppShell({
  children,
  description,
  eyebrow,
  isCompletedProject,
  role,
  title,
  userAvatarUrl,
  userDisplayName,
  userEmail,
  userRole,
}: ErpAppShellProps) {
  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-950 lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
      <ErpSidebar
        role={role ?? null}
        isCompletedProject={isCompletedProject}
        userDisplayName={userDisplayName}
        userAvatarUrl={userAvatarUrl}
        userRole={userRole}
      />
      <div className="min-w-0">
        <ErpTopbar
          description={description}
          eyebrow={eyebrow}
          title={title}
          userDisplayName={userDisplayName}
          userEmail={userEmail}
        />
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
