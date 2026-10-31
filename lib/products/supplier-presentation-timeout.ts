export async function settleSupplierPresentations<T>(promise: Promise<T>, timeoutMs = 5000): Promise<{ supplierPresentations: T | null; supplierLoadState: "loaded" | "unavailable" }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Supplier status timed out")), timeoutMs); });
    const supplierPresentations = await Promise.race([promise, timeout]);
    return { supplierPresentations, supplierLoadState: "loaded" };
  } catch (error) {
    // The page shows a neutral "unavailable" message; the reason must not vanish, so it is logged on the server.
    console.error("[local-builder] Supplier price status unavailable:", error instanceof Error ? error.message : error);
    return { supplierPresentations: null, supplierLoadState: "unavailable" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
