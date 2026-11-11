import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isWarehouseStaffRequest } from "@/lib/auth";
import { safeAuthRedirectPath } from "@/lib/auth-redirect";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeAuthRedirectPath(requestUrl.searchParams.get("next") ?? "/dashboard");

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  if (!next.startsWith("/reset-password") && await isWarehouseStaffRequest()) {
    return NextResponse.redirect(new URL("/inventory", request.url));
  }
  return NextResponse.redirect(new URL(next, request.url));
}
