"use server";

import { revalidatePath } from "next/cache";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";
import { nextClientNumber } from "@/lib/clients/client-numbering";
import { clientPayload, normalizeClientName } from "@/lib/clients/client-payload";
import { requireRecordsManager } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

type ConfirmedClient = {
  id: string;
  company_name: string;
  client_number: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
};

export type CreateConfirmedClientState =
  | {
      status: "idle";
    }
  | {
      status: "error";
      message: string;
    }
  | {
      status: "success";
      requestId: string;
      client: ConfirmedClient;
    };

function actionErrorMessage(actionLabel: string, error: unknown, fallbackMessage?: string) {
  return formatSafeActionError(actionLabel, error, fallbackMessage);
}

function createRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `client-${Date.now()}`;
}

export async function createConfirmedClient(
  _previousState: CreateConfirmedClientState,
  formData: FormData,
): Promise<CreateConfirmedClientState> {
  const { user } = await requireRecordsManager();
  const payload = clientPayload(formData, user.id);
  const requestId = createRequestId();

  if (!payload.company_name) {
    return {
      status: "error",
      message: "Client name is required.",
    };
  }

  const supabase = await createSupabaseClient();
  const { data: clients, error: readError } = await supabase
    .from("clients")
    .select("id,company_name")
    .returns<Array<{ id: string; company_name: string }>>();

  if (readError) {
    logServerActionError("CONFIRM CLIENT LOOKUP ERROR", readError, {
      action: "createConfirmedClient",
      clientName: payload.company_name,
      table: "clients",
    });

    return {
      status: "error",
      message: actionErrorMessage("Client could not be checked for duplicates", readError),
    };
  }

  const normalizedName = normalizeClientName(payload.company_name);
  const duplicateClient = (clients ?? []).find(
    (client) => normalizeClientName(client.company_name) === normalizedName,
  );

  if (duplicateClient) {
    return {
      status: "error",
      message: "A client with this exact name already exists. Link the existing client instead.",
    };
  }

  let clientNumber: string | null = null;
  try {
    clientNumber = await nextClientNumber(supabase);
  } catch (numberError) {
    logServerActionError("CONFIRM CLIENT NUMBER ASSIGN ERROR", numberError, {
      action: "createConfirmedClient",
      clientName: payload.company_name,
      table: "clients",
    });
  }

  const { data: createdClient, error: createError } = await supabase
    .from("clients")
    .insert({
      ...payload,
      ...(clientNumber ? { client_number: clientNumber } : {}),
    })
    .select("id,company_name,client_number,contact_person,phone,email")
    .single<ConfirmedClient>();

  if (createError) {
    logServerActionError("CONFIRM CLIENT CREATE ERROR", createError, {
      action: "createConfirmedClient",
      clientName: payload.company_name,
      table: "clients",
    });

    return {
      status: "error",
      message: actionErrorMessage("Client could not be created", createError),
    };
  }

  revalidatePath("/clients");

  return {
    status: "success",
    requestId,
    client: createdClient,
  };
}
