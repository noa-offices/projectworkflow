import { NextResponse } from "next/server";
import {
  loadPresentationSettings,
  savePresentationSettings,
} from "@/lib/quotations/presentation-settings-store";

type SavePayload = {
  quotationId?: unknown;
  quotation_id?: unknown;
  settings?: unknown;
  settings_json?: unknown;
};

function errorResponse(error: string, status = 500, details?: string, code?: string) {
  return NextResponse.json(
    {
      success: false,
      error,
      ...(details ? { details } : {}),
      ...(code ? { code } : {}),
    },
    { status },
  );
}

function quotationIdFromUrl(request: Request) {
  const { searchParams } = new URL(request.url);
  return searchParams.get("quotationId")?.trim() || searchParams.get("quotation_id")?.trim() || null;
}

function quotationIdFromPayload(payload: SavePayload) {
  const direct = typeof payload.quotationId === "string" ? payload.quotationId.trim() : "";
  const legacy = typeof payload.quotation_id === "string" ? payload.quotation_id.trim() : "";
  return direct || legacy || null;
}

export async function GET(request: Request) {
  const quotationId = quotationIdFromUrl(request);
  if (!quotationId) {
    return errorResponse("Missing quotationId.", 400);
  }

  const result = await loadPresentationSettings(quotationId);
  if (!result.success) {
    return errorResponse(result.error, result.status, result.details, result.code);
  }

  return NextResponse.json({
    success: true,
    settings: result.settings,
  });
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as SavePayload;
    const quotationId = quotationIdFromPayload(payload);

    if (!quotationId) {
      return errorResponse("Missing quotationId.", 400);
    }

    const result = await savePresentationSettings(quotationId, payload.settings ?? payload.settings_json);
    if (!result.success) {
      return errorResponse(result.error, result.status, result.details, result.code);
    }

    return NextResponse.json({
      success: true,
      settings: result.settings,
    });
  } catch (error) {
    console.error("LEGACY PRESENTATION SETTINGS SAVE ERROR", error);
    return errorResponse(
      "Failed to save presentation settings.",
      500,
      error instanceof Error ? error.message : "Unexpected server error.",
    );
  }
}

export async function PUT(request: Request) {
  return POST(request);
}
