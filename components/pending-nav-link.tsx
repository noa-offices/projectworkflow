"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { PendingLinkButton } from "@/components/pending-link-button";

type PendingNavLinkProps = {
  href: string;
  label: string;
  className: string;
  pendingClassName?: string;
  pendingLabel?: string;
};

function currentRouteValue(pathname: string, searchParams: ReturnType<typeof useSearchParams>) {
  const query = searchParams.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

export function PendingNavLink({
  href,
  label,
  className,
  pendingClassName,
  pendingLabel = "Loading...",
}: PendingNavLinkProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentValue = currentRouteValue(pathname, searchParams);
  const isCurrentRoute = href === currentValue;

  if (isCurrentRoute) {
    return (
      <span
        aria-current="page"
        className={`${className} pointer-events-none`}
      >
        {label}
      </span>
    );
  }

  return (
    <PendingLinkButton
      href={href}
      pendingLabel={pendingLabel}
      className={`${className}${pendingClassName ? ` ${pendingClassName}` : ""}`}
    >
      {label}
    </PendingLinkButton>
  );
}
