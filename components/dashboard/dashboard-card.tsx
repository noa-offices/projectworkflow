import type { ReactNode } from "react";

export function DashboardCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-zinc-200 bg-white shadow-sm ${className}`}>
      {children}
    </section>
  );
}
