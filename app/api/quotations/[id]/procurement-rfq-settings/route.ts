import { NextResponse } from "next/server";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";
import {
  loadProcurementRfqSettings,
  saveProcurementRfqSettings,
} from "@/lib/quotations/procurement-rfq-settings-store";

type SavePayload = {
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

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = await loadProcurementRfqSettings(id);

  if (!result.success) {
    return errorResponse(result.error, result.status, result.details, result.code);
  }

  return NextResponse.json({
    success: true,
    hasStoredSettings: result.hasStoredSettings,
    settings: result.settings,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const payload = await request.json() as SavePayload;
    const result = await saveProcurementRfqSettings(id, payload.settings ?? payload.settings_json);

    if (!result.success) {
      return errorResponse(result.error, result.status, result.details, result.code);
    }

    return NextResponse.json({
      success: true,
      settings: result.settings,
    });
  } catch (error) {
    logServerActionError("PROCUREMENT RFQ SETTINGS SAVE UNEXPECTED ERROR", error, {
      action: "procurementRfqSettingsRoute.POST",
      table: "quotation_procurement_rfqs",
      field: "settings_json",
    });
    return errorResponse(
      formatSafeActionError("Failed to save RFQ settings", error),
      500,
      undefined,
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return POST(request, context);
}
