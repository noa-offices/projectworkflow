import type { ReactNode } from "react";

export function DashboardCard({
  children,
  className = "",
  bg = "bg-white",
}: {
  children: ReactNode;
  className?: string;
  bg?: string;
}) {
  return (
    <section className={`rounded-lg border border-zinc-200 shadow-sm ${bg} ${className}`}>
      {children}
    </section>
  );
}
