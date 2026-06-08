import type { ReactNode } from "react";
import { ErpSidebar } from "@/components/layout/erp-sidebar";
import { ErpTopbar } from "@/components/layout/erp-topbar";

type ErpAppShellProps = {
  children: ReactNode;
  description: string;
  eyebrow?: string;
  title: string;
  userDisplayName?: string;
  userEmail?: string | null;
};

export function ErpAppShell({
  children,
  description,
  eyebrow,
  title,
  userDisplayName,
  userEmail,
}: ErpAppShellProps) {
  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-950 lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
      <ErpSidebar />
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
