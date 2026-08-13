export function reviewDestinationExpanded(destination: string, collapsed: Readonly<Record<string, boolean>>, routeKey: string) {
  return destination !== "skip" && collapsed[routeKey] === false;
}

export function setReviewDestinationExpanded(current: Readonly<Record<string, boolean>>, routeKey: string, expanded: boolean) {
  return { ...current, [routeKey]: !expanded };
}
