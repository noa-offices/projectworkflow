"use server";

import { requireQuotationActionUser } from "@/lib/auth";
import {
  parseFinalSpecificationRequest,
  type FinalSpecificationActionResult,
  type FinalSpecificationRequest,
} from "@/lib/quotations/final-specification-ai-contract";
import {
  FinalSpecificationProviderError,
  improveFinalSpecificationWithProvider,
} from "@/lib/quotations/final-specification-ai-provider.server";

export async function runFinalSpecificationImprovement(
  input: FinalSpecificationRequest,
): Promise<FinalSpecificationActionResult> {
  await requireQuotationActionUser();
  const request = parseFinalSpecificationRequest(input);
  if (!request) {
    return { ok: false, code: "invalid_request", message: "A valid selected product configuration is required." };
  }

  try {
    return { ok: true, result: await improveFinalSpecificationWithProvider(request) };
  } catch (error) {
    const notConfigured = error instanceof FinalSpecificationProviderError && error.kind === "not_configured";
    return {
      ok: false,
      code: notConfigured ? "not_configured" : "provider_failed",
      message: notConfigured
        ? "Final specification AI is not configured."
        : error instanceof FinalSpecificationProviderError
          ? error.message
          : "Final specification could not be improved.",
    };
  }
}
