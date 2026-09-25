import { NextResponse } from "next/server";
import { fetchNoaAttentionCapability } from "@/lib/noa/noa-attention-capability.server";

// N2A3: the SMALLEST possible read transport for the launcher badge - a plain authenticated GET
// that calls the exact same, already-authoritative Attention capability the chat route dispatches
// to (lib/noa/noa-orchestrator.ts's `domain === "Attention"` branch), and returns only a bounded
// `{ available, count }` shape. No business rule (price/procurement/payment) is ever reevaluated
// here; no service-role/admin client is used (fetchNoaAttentionCapability's own user-scoped
// createClient() is the only database access); no client-supplied user id/role is ever accepted.
// The capability's own requireActiveUser()/requireProductLibraryManager()/
// requireProcurementManager()/canViewClientPayments() gates are the only authorization this route
// relies on - a permission gap (including "not signed in") already resolves inside the capability
// to a safe `{ ok: false }` result, never a thrown/redirecting error, so this route never needs
// its own separate auth check.
export async function GET() {
  try {
    const result = await fetchNoaAttentionCapability("", { pathname: "", section: "other" });
    if (!result.ok) {
      return NextResponse.json({ available: false, count: 0 });
    }

    const data = result.data as { count?: unknown };
    const count = typeof data.count === "number" ? data.count : 0;
    return NextResponse.json({ available: true, count });
  } catch {
    // Never expose a raw error to the client - a failure here must never surface as a chat error
    // or otherwise disturb NOA (PART 5); the launcher badge simply stays hidden.
    return NextResponse.json({ available: false, count: 0 });
  }
}
