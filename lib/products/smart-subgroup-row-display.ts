export type SmartSubgroupDisplayRow = {
  displayName: string | null;
  label: string | null;
  supplierCodes: string[];
  referenceCodes: string[];
};

function firstCode(codes: string[]) {
  return codes.find((code) => code.trim())?.trim() ?? null;
}

function labelCode(label: string | null) {
  const value = label?.trim() ?? "";
  return value && value === value.toUpperCase() && /^[A-Z0-9][A-Z0-9 ._/-]*$/.test(value) ? value : null;
}

export function smartSubgroupRowCode(row: SmartSubgroupDisplayRow) {
  return firstCode(row.supplierCodes) ?? firstCode(row.referenceCodes) ?? labelCode(row.label);
}

export function smartSubgroupRowLabel(row: SmartSubgroupDisplayRow) {
  const name = row.displayName ?? row.label ?? "";
  const code = smartSubgroupRowCode(row);
  return code && code !== name ? `${code} — ${name}` : name;
}
