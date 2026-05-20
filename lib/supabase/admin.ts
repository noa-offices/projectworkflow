import "server-only";

import { createClient } from "@supabase/supabase-js";

type AdminClientResult =
  | {
      client: ReturnType<typeof createClient>;
      error: null;
    }
  | {
      client: null;
      error: string;
    };

function decodeJwtPayload(token: string) {
  const segments = token.split(".");

  if (segments.length !== 3) {
    return null;
  }

  try {
    const normalized = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as { role?: string };
  } catch {
    return null;
  }
}

function validateAdminKey(serviceRoleKey: string) {
  if (serviceRoleKey.startsWith("sb_publishable_")) {
    return "Server admin key is not a privileged Supabase key.";
  }

  if (serviceRoleKey.startsWith("sb_secret_")) {
    return null;
  }

  const payload = decodeJwtPayload(serviceRoleKey);

  if (payload && payload.role !== "service_role") {
    return "Server admin key is not a privileged Supabase key.";
  }

  return null;
}

export function createAdminClient(): AdminClientResult {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      client: null,
      error: "Server admin delete is not configured.",
    };
  }

  const validationError = validateAdminKey(serviceRoleKey);

  if (validationError) {
    return {
      client: null,
      error: validationError,
    };
  }

  return {
    client: createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }),
    error: null,
  };
}
