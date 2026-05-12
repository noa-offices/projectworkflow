export type BrandOriginSupplierDisplay = {
  brand: string | null;
  origin: string | null;
  primaryLine: string | null;
  supplier: string | null;
};

function cleanText(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalized(value: string | null) {
  return (value ?? "").trim().toLowerCase();
}

export function formatBrandOriginSupplier({
  brandName,
  origin,
  supplier,
}: {
  brandName?: string | null;
  origin?: string | null;
  supplier?: string | null;
}): BrandOriginSupplierDisplay {
  const brand = cleanText(brandName);
  const originValue = cleanText(origin);
  const supplierValue = cleanText(supplier);

  const normalizedBrand = normalized(brand);
  const normalizedOrigin = normalized(originValue);
  const normalizedSupplier = normalized(supplierValue);

  const primaryLine = brand && originValue
    ? `${brand} - ${originValue}`
    : brand || originValue || null;

  const supplierLine =
    normalizedSupplier &&
    normalizedSupplier !== normalizedBrand &&
    normalizedSupplier !== normalizedOrigin
      ? supplierValue
      : null;

  return {
    brand,
    origin: originValue,
    primaryLine,
    supplier: supplierLine,
  };
}

export function specificationWithoutDuplicateCode({
  code,
  specification,
}: {
  code?: string | null;
  specification?: string | null;
}) {
  const normalizedCode = cleanText(code);
  const normalizedSpecification = cleanText(specification);

  if (!normalizedCode || !normalizedSpecification) {
    return normalizedSpecification;
  }

  const remainingLines = normalizedSpecification
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index) => {
      if (line.trim().toLowerCase() !== normalizedCode.toLowerCase()) {
        return true;
      }

      return index !== 0;
    });

  const cleaned = remainingLines.join("\n").trim();
  return cleaned || null;
}
