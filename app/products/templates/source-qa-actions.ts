"use server";

import { requireProductLibraryManager } from "@/lib/auth";
import { validateProductTemplateDraft } from "@/lib/products/product-template-draft";
import { temporaryProductSourcePath } from "@/lib/products/temporary-product-source";
import { SourceQaAiProviderError, verifySourceQaWithProvider } from "@/lib/products/source-qa-ai-provider.server";
import { parseSourceQaAiReport, type SourceQaAiActionResult, type SourceQaAiRequest } from "@/lib/products/source-qa-ai-contract";
import { validateOriginalImportedJsonSources } from "@/lib/products/original-imported-json-sources";
import { createClient } from "@/lib/supabase/server";

export async function runSourceQaAi(request: SourceQaAiRequest): Promise<SourceQaAiActionResult> {
  await requireProductLibraryManager();
  const storagePath = temporaryProductSourcePath(typeof request?.sourcePdfStoragePath === "string" ? request.sourcePdfStoragePath : null);
  if (!storagePath || typeof request?.sourcePdfFileName !== "string" || !request.sourcePdfFileName.trim()) return { ok: false, code: "invalid_source_pdf", message: "A valid temporary source PDF is required." };
  const draft = validateProductTemplateDraft(request.draft);
  if (!draft.valid || !draft.draft) return { ok: false, code: "invalid_draft", message: "A valid Product Template draft is required." };
  const originalSources = validateOriginalImportedJsonSources(request.originalImportedJsonSources);
  if (!originalSources.valid) return { ok: false, code: originalSources.code, message: originalSources.message };
  const { data, error } = await (await createClient()).storage.from("product-source-files").download(storagePath);
  if (error || !data) return { ok: false, code: "source_pdf_unavailable", message: "Source PDF could not be loaded." };
  try {
    const report = parseSourceQaAiReport(await verifySourceQaWithProvider({ sourcePdf: { fileName: request.sourcePdfFileName, bytes: await data.arrayBuffer() }, originalImportedJsonSources: originalSources.sources, draft: draft.draft }));
    return report ? { ok: true, report } : { ok: false, code: "invalid_report", message: "AI Source QA returned an invalid report." };
  } catch (error) {
    return { ok: false, code: "provider_failed", message: error instanceof SourceQaAiProviderError ? error.message : "AI Source QA could not be completed." };
  }
}
