/** Selection can never contain a row hidden by the current review view. */
export function retainShownSelection(selected: ReadonlySet<string>, shownKeys: Iterable<string>): Set<string> {
  const shown = new Set(shownKeys);
  return new Set([...selected].filter((key) => shown.has(key)));
}
