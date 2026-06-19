import { NextResponse } from "next/server";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";
import {
  loadDeliveryNoteSettings,
  saveDeliveryNoteSettings,
} from "@/lib/quotations/delivery-note-settings-store";

type SavePayload = {
  settings?: unknown;
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
  const result = await loadDeliveryNoteSettings(id);

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
    const result = await saveDeliveryNoteSettings(id, payload.settings);

    if (!result.success) {
      return errorResponse(result.error, result.status, result.details, result.code);
    }

    return NextResponse.json({
      success: true,
      settings: result.settings,
    });
  } catch (error) {
    logServerActionError("DELIVERY NOTE SETTINGS SAVE UNEXPECTED ERROR", error, {
      action: "deliveryNoteSettingsRoute.POST",
      table: "quotation_delivery_notes",
      field: "settings_json",
    });
    return errorResponse(
      formatSafeActionError("Failed to save delivery note settings", error),
      500,
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return POST(request, context);
}
