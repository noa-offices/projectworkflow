export function memberInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?"
  );
}

/** Neighbours in the order the Team Overview table shows. Stops at both ends (no wrap). */
export function teamMemberNeighbours(memberIds: readonly string[], selectedId: string) {
  const index = memberIds.indexOf(selectedId);
  if (index < 0) return { index: -1, total: memberIds.length, prevId: null, nextId: null };
  return {
    index,
    total: memberIds.length,
    prevId: index > 0 ? memberIds[index - 1] : null,
    nextId: index < memberIds.length - 1 ? memberIds[index + 1] : null,
  };
}
