import { isIP } from "node:net";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/gif",
]);
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function errorResponse(error: string, status: number, details?: string) {
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
  return normalized || "Unexpected server error.";
}

function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(normalized)) return true;
  if (normalized.endsWith(".local")) return true;

  const ipVersion = isIP(normalized.replace(/^\[(.*)\]$/, "$1"));
  if (!ipVersion) return false;

  if (ipVersion === 4) {
    const [first, second] = normalized.split(".").map(Number);
    if (first === 10) return true;
    if (first === 127) return true;
    if (first === 192 && second === 168) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    return false;
  }

  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80");
}

function allowedHosts(requestHost: string) {
  const hosts = new Set<string>([
    requestHost.toLowerCase(),
    "noaoffices.com",
    "www.noaoffices.com",
  ]);

  try {
    const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host.toLowerCase()
      : null;
    if (supabaseHost) hosts.add(supabaseHost);
  } catch {
    // Ignore malformed env; allowlist remains conservative.
  }

  return hosts;
}

function isAllowedHost(hostname: string, requestHost: string) {
  const normalized = hostname.toLowerCase();
  if (isPrivateHostname(normalized)) return false;

  const hosts = allowedHosts(requestHost);
  return Array.from(hosts).some((allowedHost) => normalized === allowedHost || normalized.endsWith(`.${allowedHost}`));
}

async function requireProxyAccess() {
  if (process.env.NODE_ENV !== "production") return true;

  const supabase = await createSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return false;

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_status")
    .eq("id", user.id)
    .maybeSingle<{ account_status: string | null }>();

  return profile?.account_status === "active";
}

export async function GET(request: Request) {
  if (!await requireProxyAccess()) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const requestUrl = new URL(request.url);
    const source = requestUrl.searchParams.get("src");
    if (!source) {
      return errorResponse("Image source is required.", 400);
    }

    let remoteUrl: URL;
    try {
      remoteUrl = new URL(source);
    } catch {
      return errorResponse("Invalid image source URL.", 400);
    }

    if (!["http:", "https:"].includes(remoteUrl.protocol)) {
      return errorResponse("Only http and https image URLs are allowed.", 400);
    }

    if (!isAllowedHost(remoteUrl.hostname, requestUrl.host)) {
      return errorResponse("Image host is not allowed for export proxying.", 403);
    }

    const upstreamResponse = await fetch(remoteUrl.toString(), {
      headers: {
        Accept: "image/png,image/jpeg,image/webp,image/svg+xml,image/gif,image/*;q=0.8,*/*;q=0.5",
      },
      cache: "no-store",
    });

    if (!upstreamResponse.ok) {
      return errorResponse("Failed to fetch export image.", upstreamResponse.status, `Host: ${remoteUrl.hostname}`);
    }

    const contentType = upstreamResponse.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
      return errorResponse("Proxied response was not an allowed image type.", 415, `Host: ${remoteUrl.hostname}`);
    }

    const declaredLength = Number(upstreamResponse.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
      return errorResponse("Image is too large for export.", 413, `Host: ${remoteUrl.hostname}`);
    }

    const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return errorResponse("Image is too large for export.", 413, `Host: ${remoteUrl.hostname}`);
    }

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("PRESENTATION IMAGE PROXY ERROR", error);
    return errorResponse("Failed to proxy presentation image.", 500, safeErrorDetails(error));
  }
}
