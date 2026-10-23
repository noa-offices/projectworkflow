import { InventoryOverviewView } from "@/components/inventory/overview-view";
import { getInventoryOverview } from "@/lib/inventory/queries";

export default async function InventoryPage() {
  return <InventoryOverviewView overview={await getInventoryOverview()} />;
}
