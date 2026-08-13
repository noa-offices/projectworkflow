export type VisualSubgroup<RowId extends string = string> = {
  id: string;
  subgroup_name: string;
  row_ids: RowId[];
};

export type VisualSubgroupRowSection<TRow> = {
  subgroup: VisualSubgroup | null;
  rows: TRow[];
};

// This is a UI-only projection: source row order and objects remain unchanged.
export function visualSubgroupRowSections<TRow extends { id: string }>(rows: readonly TRow[], subgroups: readonly VisualSubgroup[]): VisualSubgroupRowSection<TRow>[] {
  if (!subgroups.length) return [{ subgroup: null, rows: [...rows] }];
  const claimed = new Set<string>();
  const sections = subgroups.map((subgroup) => {
    const subgroupRows = new Set(subgroup.row_ids);
    const assignedRows = rows.filter((row) => subgroupRows.has(row.id) && !claimed.has(row.id));
    assignedRows.forEach((row) => claimed.add(row.id));
    return { subgroup, rows: assignedRows };
  });
  const ungrouped = rows.filter((row) => !claimed.has(row.id));
  return [...sections, ...(ungrouped.length ? [{ subgroup: null, rows: ungrouped }] : [])];
}

export function assignVisualSubgroupRows<TRow extends { id: string }, TSubgroup extends VisualSubgroup>(rows: readonly TRow[], subgroups: readonly TSubgroup[], subgroupId: string, selectedRowIds: ReadonlySet<string>): TSubgroup[] {
  const available = new Set(rows.map((row) => row.id));
  const selected = new Set([...selectedRowIds].filter((rowId) => available.has(rowId)));
  return subgroups.map((subgroup) => ({
    ...subgroup,
    row_ids: subgroup.id === subgroupId
      ? rows.filter((row) => selected.has(row.id)).map((row) => row.id)
      : subgroup.row_ids.filter((rowId) => !selected.has(rowId)),
  }));
}
