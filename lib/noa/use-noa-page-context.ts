"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { NoaPageContext, NoaPageSection } from "./noa-types";

const SECTION_PREFIXES: ReadonlyArray<{ prefix: string; section: NoaPageSection }> = [
  { prefix: "/dashboard", section: "dashboard" },
  { prefix: "/clients", section: "projects" },
  { prefix: "/projects", section: "projects" },
  { prefix: "/products", section: "products" },
  { prefix: "/quotations", section: "quotations" },
  { prefix: "/procurement", section: "procurement" },
  { prefix: "/insights", section: "insights" },
  { prefix: "/system", section: "system" },
  { prefix: "/settings", section: "system" },
];

function sectionForPathname(pathname: string): NoaPageSection {
  const match = SECTION_PREFIXES.find(
    ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return match?.section ?? "other";
}

// First path segment after `prefix/`, e.g. pathSegmentAfter("/quotations/Q-2026-0142", "/quotations") -> "Q-2026-0142".
function pathSegmentAfter(pathname: string, prefix: string): string | undefined {
  if (!pathname.startsWith(`${prefix}/`)) return undefined;
  const segment = pathname.slice(prefix.length + 1).split("/")[0];
  return segment ? decodeURIComponent(segment) : undefined;
}

// Pure so it can be unit tested without mounting the hook: derives NoaPageContext from a
// pathname + search params, exactly as usePathname()/useSearchParams() would supply them.
export function parseNoaPageContext(pathname: string, searchParams: URLSearchParams): NoaPageContext {
  const quotationId = pathSegmentAfter(pathname, "/quotations");
  const projectId = pathSegmentAfter(pathname, "/clients/projects");
  const productTemplateId = searchParams.get("template") ?? undefined;
  const brandId = searchParams.get("brand") ?? searchParams.get("panelBrand") ?? undefined;

  return {
    pathname,
    section: sectionForPathname(pathname),
    ...(quotationId ? { quotationId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(productTemplateId ? { productTemplateId } : {}),
    ...(brandId ? { brandId } : {}),
  };
}

export function useNoaPageContext(): NoaPageContext {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return parseNoaPageContext(pathname, searchParams);
}
