import { requireActiveUser } from "@/lib/auth";
import { loadQuotationPresentationData } from "@/lib/quotations/presentation-document";
import { exportQuotationPresentationPptx } from "@/lib/quotations/presentation-pptx";

export const dynamic = "force-dynamic";

function errorResponse(error: string, status = 500, details?: string) {
  return Response.json(
    {
      success: false,
      error,
      ...(details ? { details } : {}),
    },
    { status },
  );
}

function safeErrorDetails(error: unknown) {
  if (!(error instanceof Error)) return "Unexpected server error.";

  const normalized = error.message.replace(/\s+/g, " ").trim();
  if (!normalized) return "Unexpected server error.";

  return normalized
    .replace(/(apikey|api_key|authorization|bearer|token|secret)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/(apikey|api_key|authorization|bearer|token|secret):\s*([^\s,;]+)/gi, "$1: [redacted]");
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await requireActiveUser();
  const { id } = await context.params;
  const presentationData = await loadQuotationPresentationData(id);

  if (!presentationData) {
    return errorResponse("Quotation not found.", 404);
  }

  try {
    const { content, fileName } = await exportQuotationPresentationPptx(presentationData);

    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("PRESENTATION PPTX EXPORT ERROR", error);
    return errorResponse(
      "Failed to export presentation PPTX",
      500,
      safeErrorDetails(error),
    );
  }
}
