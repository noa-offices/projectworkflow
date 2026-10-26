import { InventoryOverviewView } from "@/components/inventory/overview-view";
import { getInventoryOverview, getInventoryOverviewActivity } from "@/lib/inventory/queries";
import { requireInventoryUser } from '@/lib/auth';

export default async function InventoryPage() {
  const { profile } = await requireInventoryUser();
  const [overview, activity] = await Promise.all([getInventoryOverview(),getInventoryOverviewActivity()]);
  return <InventoryOverviewView overview={overview} activity={activity} role={profile?.role ?? null} />;
}
