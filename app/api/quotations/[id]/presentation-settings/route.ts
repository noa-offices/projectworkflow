import { NextResponse } from "next/server";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";
import {
  loadPresentationSettings,
  savePresentationSettings,
} from "@/lib/quotations/presentation-settings-store";

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
  const result = await loadPresentationSettings(id);

  if (!result.success) {
    return errorResponse(result.error, result.status, result.details, result.code);
  }

  return NextResponse.json({
    success: true,
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
    const result = await savePresentationSettings(id, payload.settings ?? payload.settings_json);

    if (!result.success) {
      return errorResponse(result.error, result.status, result.details, result.code);
    }

    return NextResponse.json({
      success: true,
      settings: result.settings,
    });
  } catch (error) {
    logServerActionError("PRESENTATION SETTINGS SAVE UNEXPECTED ERROR", error, {
      action: "presentationSettingsRoute.POST",
      table: "quotation_presentations",
      field: "settings_json",
    });
    return errorResponse(
      formatSafeActionError("Failed to save presentation settings", error),
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
