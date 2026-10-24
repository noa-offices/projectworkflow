import { InventoryOverviewView } from "@/components/inventory/overview-view";
import { getInventoryOverview } from "@/lib/inventory/queries";
import { requireInventoryUser } from '@/lib/auth';

export default async function InventoryPage() {
  const { profile } = await requireInventoryUser();
  return <InventoryOverviewView overview={await getInventoryOverview()} role={profile?.role ?? null} />;
}
