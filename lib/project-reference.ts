import { buildQuotationDocumentNumber } from "@/lib/quotation-options";

type ProjectReferenceInput = {
  project_number?: string | null;
  project_code?: string | null;
  project_year?: string | number | null;
};

type QuotationDocumentReferenceInput = ProjectReferenceInput & {
  legacy_reference?: string | null;
  option_no?: number | null;
  quotation_no?: string | null;
  revision_no?: number | null;
};

function trimmedValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function formatProjectReferenceDisplay(project?: ProjectReferenceInput | null) {
  const projectNumber = trimmedValue(project?.project_number);
  if (projectNumber) {
    return projectNumber;
  }

  const projectCode = trimmedValue(project?.project_code);
  const projectYear =
    typeof project?.project_year === "number"
      ? String(project.project_year)
      : trimmedValue(project?.project_year);
  const legacyReference = [projectCode, projectYear].filter(Boolean).join(" / ");

  return legacyReference || null;
}

export function formatProjectReferenceWithYearDisplay(project?: ProjectReferenceInput | null) {
  const projectNumber = trimmedValue(project?.project_number);
  const projectCode = trimmedValue(project?.project_code);
  const projectYear =
    typeof project?.project_year === "number"
      ? String(project.project_year)
      : trimmedValue(project?.project_year);

  if (projectNumber && projectYear) {
    return `${projectNumber} / ${projectYear}`;
  }

  if (projectNumber) {
    return projectNumber;
  }

  if (projectCode && projectYear) {
    return `${projectCode} / ${projectYear}`;
  }

  if (projectCode) {
    return projectCode;
  }

  return projectYear || null;
}

export function formatQuotationDocumentNumberDisplay(quotation?: QuotationDocumentReferenceInput | null) {
  const projectNumber = trimmedValue(quotation?.project_number);
  const quotationNo = trimmedValue(quotation?.quotation_no);

  if (projectNumber && quotationNo?.startsWith(projectNumber)) {
    return quotationNo;
  }

  const generatedQuotationNo = buildQuotationDocumentNumber({
    projectNumber,
    optionNo: quotation?.option_no,
    revisionNo: quotation?.revision_no,
  });

  if (generatedQuotationNo) {
    return generatedQuotationNo;
  }

  const projectReference = formatProjectReferenceDisplay(quotation);
  if (projectReference) {
    return projectReference;
  }

  return quotationNo ?? trimmedValue(quotation?.legacy_reference) ?? null;
}
