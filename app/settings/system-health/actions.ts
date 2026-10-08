"use server";

import { requireSystemOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManageSupplierCapacity } from "@/lib/products/supplier-price-repository";
import { capacityInputBytes, type CapacitySettingsInput } from "@/lib/products/system-capacity";
import { captureSystemCapacitySnapshot, saveSystemCapacitySettings, systemCapacityReport, systemCapacityReportWithStorageCleanup } from "@/lib/products/system-capacity.server";
import { cleanProductSourceCandidates } from "@/lib/products/product-source-cleanup.server";

async function ownerClient() {
  const { profile } = await requireSystemOwner();
  if (!canManageSupplierCapacity(profile?.role, profile?.account_status)) throw Error("Only the active System Owner can view database health.");
  return createClient();
}

export async function loadSystemCapacityReport() {
  return systemCapacityReportWithStorageCleanup(await ownerClient());
}

export async function captureCapacitySnapshot() {
  const client = await ownerClient();
  await captureSystemCapacitySnapshot(client);
  return systemCapacityReportWithStorageCleanup(client);
}

export async function saveCapacitySettings(input: CapacitySettingsInput) {
  const client = await ownerClient();
  const databaseBytes = capacityInputBytes(input.databaseValue, input.databaseUnit);
  const storageBytes = capacityInputBytes(input.storageValue, input.storageUnit);
  await saveSystemCapacitySettings(client, databaseBytes, storageBytes);
  return systemCapacityReportWithStorageCleanup(client);
}

export async function cleanTemporaryProductSources(paths: string[]) {
  const client = await ownerClient();
  const result = await cleanProductSourceCandidates(paths);
  const report = await systemCapacityReport(client);
  return { ...result, report: { ...report, storage_cleanup: result.analysis } };
}
