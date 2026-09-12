"use server";

import { requireProductLibraryManager } from "@/lib/auth";
import { validateProductTemplateDraft } from "@/lib/products/product-template-draft";
import { temporaryProductSourcePath } from "@/lib/products/temporary-product-source";
import { SourceQaAiProviderError, verifySourceQaWithProvider } from "@/lib/products/source-qa-ai-provider.server";
import { parseSourceQaAiReport, type SourceQaAiActionResult, type SourceQaAiRequest } from "@/lib/products/source-qa-ai-contract";
import { createClient } from "@/lib/supabase/server";

export async function runSourceQaAi(request: SourceQaAiRequest): Promise<SourceQaAiActionResult> {
  await requireProductLibraryManager();
  const storagePath = temporaryProductSourcePath(typeof request?.sourcePdfStoragePath === "string" ? request.sourcePdfStoragePath : null);
  if (!storagePath || typeof request?.sourcePdfFileName !== "string" || !request.sourcePdfFileName.trim()) return { ok: false, message: "A valid temporary source PDF is required." };
  const draft = validateProductTemplateDraft(request.draft);
  if (!draft.valid || !draft.draft) return { ok: false, message: "A valid Product Template draft is required." };
  const { data, error } = await (await createClient()).storage.from("product-source-files").download(storagePath);
  if (error || !data) return { ok: false, message: "Source PDF could not be loaded." };
  try {
    const report = parseSourceQaAiReport(await verifySourceQaWithProvider({ sourcePdf: { fileName: request.sourcePdfFileName, bytes: await data.arrayBuffer() }, draft: draft.draft }));
    return report ? { ok: true, report } : { ok: false, message: "AI Source QA returned an invalid report." };
  } catch (error) {
    return { ok: false, message: error instanceof SourceQaAiProviderError ? error.message : "AI Source QA could not be completed." };
  }
}
