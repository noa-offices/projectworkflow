import type { SmartReviewRoute } from "./smart-product-review-routing";

export type SmartSetupBlockingIssue = { text: string; routeKey: string | null };

export const SMART_ROUTE_ELEMENT_PREFIX = "smart-route-";
export const smartRouteElementId = (routeKey: string) => `${SMART_ROUTE_ELEMENT_PREFIX}${routeKey}`;

/** Routing errors are prefixed with the route's sourceName; only attribute an issue to a group when that prefix is unambiguous. */
export function smartSetupBlockingIssues({ routes, routingErrors, currencyBlocked, accessoryReviewMessage }: { routes: Pick<SmartReviewRoute, "key" | "sourceName">[]; routingErrors: string[]; currencyBlocked: boolean; accessoryReviewMessage: string | null }): SmartSetupBlockingIssue[] {
  const issues: SmartSetupBlockingIssue[] = [...new Set(routingErrors)].map((text) => {
    const matches = routes.filter((route) => route.sourceName && text.startsWith(route.sourceName));
    const longest = matches.reduce((max, route) => Math.max(max, route.sourceName.length), 0);
    const best = matches.filter((route) => route.sourceName.length === longest);
    return { text, routeKey: best.length === 1 ? best[0].key : null };
  });
  if (currencyBlocked) issues.push({ text: "Select a currency before applying imported prices.", routeKey: null });
  if (accessoryReviewMessage) issues.push({ text: accessoryReviewMessage, routeKey: null });
  return issues;
}

type RevealableElement = { open?: boolean; parentElement: RevealableElement | null; tagName: string; querySelector: (selector: string) => RevealableElement | null; scrollIntoView?: (options?: ScrollIntoViewOptions) => void; classList: { add: (...names: string[]) => void; remove: (...names: string[]) => void } };

/** Expands every collapsed ancestor section and the group's own details, scrolls it into view and briefly highlights it. Returns false when the group is not rendered. */
export function revealSmartSetupGroup(doc: { getElementById: (id: string) => unknown }, routeKey: string, setTimer: (callback: () => void, ms: number) => unknown = setTimeout): boolean {
  const element = doc.getElementById(smartRouteElementId(routeKey)) as RevealableElement | null;
  if (!element) return false;
  for (let node: RevealableElement | null = element; node; node = node.parentElement) if (node.tagName === "DETAILS") node.open = true;
  const own = element.querySelector("details");
  if (own) own.open = true;
  element.scrollIntoView?.({ behavior: "smooth", block: "center" });
  const highlight = ["ring-2", "ring-amber-400"];
  element.classList.add(...highlight);
  setTimer(() => element.classList.remove(...highlight), 1800);
  return true;
}
