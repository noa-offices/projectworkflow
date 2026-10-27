"use server";

import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listReviewDecisions, saveReviewDecisions } from "@/lib/products/supplier-review-decision-service";

const dependencies = { getProfile: async () => (await requireActiveUser()).profile, getClient: createClient };
export async function listSupplierPriceDecisions(sourceId: unknown) { return listReviewDecisions(dependencies, sourceId); }
export async function saveSupplierPriceDecisions(decisions: unknown) { return saveReviewDecisions(dependencies, decisions); }
