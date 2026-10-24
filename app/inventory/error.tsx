"use client";
import Link from "next/link";
import { buttonClass } from "@/components/inventory/inventory-ui";
import { ErrorState } from "@/components/inventory/inventory-ui-client";

export default function InventoryError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <ErrorState title="Inventory did not load" text="Check your internet connection, then try again." onRetry={() => unstable_retry()}><Link href="/inventory" className={buttonClass.secondary}>Go to overview</Link></ErrorState>;
}
