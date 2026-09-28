// Phase 0 (NOA test/observability foundation): deterministic, non-production fixture data for the
// golden conversation harness (see noa-golden-harness.ts). Every id/number here is fake - nothing
// in this file is read from or written to Supabase. Kept as plain data only (no capability logic,
// no orchestrator logic) so the harness can shape it into whatever NoaCapabilityResult.data the
// real orchestrator expects for a given scenario.

export type NoaFixtureProjectFile = {
  clientName: string;
  currency: string;
  orderNo: string;
  reference: string;
  status: "active" | "completed" | "cancelled";
  total: number;
};

export type NoaFixtureQuotation = {
  id: string; // fake quotations.id UUID, as real status rows carry
  quotationNo: string;
  // Persisted keys, as stored in quotations.status. "draft" is what users see labelled "Pending".
  status: "draft" | "sent_to_client" | "client_confirmed";
  client: string;
  // A client-confirmed quotation is linked to exactly one fixture Project File below; every other
  // quotation leaves this unset.
  projectOrderNo?: string;
};

// Part 6: exactly 5 quotations - 1 sent_to_client, 2 pending, 2 client_confirmed, each
// client-confirmed quotation mapped to a known (fixture) Project File.
export const NOA_GOLDEN_PROJECT_FILES: NoaFixtureProjectFile[] = [
  { clientName: "Fixture Client Alpha", currency: "USD", orderNo: "CO-0003-001", reference: "CO-0003-001", status: "active", total: 15000 },
  { clientName: "Fixture Client Beta", currency: "USD", orderNo: "CO-0004-001", reference: "CO-0004-001", status: "active", total: 22000 },
  { clientName: "Fixture Client Gamma", currency: "USD", orderNo: "CO-0005-001", reference: "CO-0005-001", status: "completed", total: 9000 },
];

export const NOA_GOLDEN_QUOTATIONS: NoaFixtureQuotation[] = [
  { id: "00000000-0000-4000-8000-000000001001", quotationNo: "QN-1001", status: "sent_to_client", client: "Fixture Client Delta" },
  { id: "00000000-0000-4000-8000-000000001002", quotationNo: "QN-1002", status: "draft", client: "Fixture Client Epsilon" },
  { id: "00000000-0000-4000-8000-000000001003", quotationNo: "QN-1003", status: "draft", client: "Fixture Client Zeta" },
  { id: "00000000-0000-4000-8000-000000001004", quotationNo: "QN-1004", status: "client_confirmed", client: "Fixture Client Alpha", projectOrderNo: "CO-0003-001" },
  { id: "00000000-0000-4000-8000-000000001005", quotationNo: "QN-1005", status: "client_confirmed", client: "Fixture Client Beta", projectOrderNo: "CO-0004-001" },
];

export const NOA_GOLDEN_CLIENT_CONFIRMED_QUOTATIONS = NOA_GOLDEN_QUOTATIONS.filter(
  (quotation) => quotation.status === "client_confirmed",
);
