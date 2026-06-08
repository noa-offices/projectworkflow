import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export type SidebarNavItem = {
  active?: boolean;
  disabled?: boolean;
  href?: string;
  icon: LucideIcon;
  label: string;
  suffix?: string;
};

export function SidebarNavGroup({
  items,
  title,
}: {
  items: SidebarNavItem[];
  title: string;
}) {
  return (
    <nav className="grid gap-1" aria-label={title}>
      <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">{title}</p>
      {items.map((item) => {
        const Icon = item.icon;
        const content = (
          <>
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span className="flex-1">{item.label}</span>
            {item.suffix ? <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">{item.suffix}</span> : null}
          </>
        );

        const className = [
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
          item.active ? "bg-emerald-50 text-emerald-900" : "text-zinc-700 hover:bg-zinc-100 hover:text-emerald-900",
          item.disabled ? "cursor-not-allowed opacity-60 hover:bg-transparent hover:text-zinc-700" : "",
        ].join(" ");

        if (!item.href || item.disabled) {
          return (
            <div key={item.label} className={className} aria-disabled="true">
              {content}
            </div>
          );
        }

        return (
          <Link
            key={item.label}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            className={className}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
