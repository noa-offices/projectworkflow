import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { MyCollectionTabs } from "@/components/products/my-collection-tabs";
import { requireActiveUser } from "@/lib/auth";
import { listCustomItemsForUser } from "@/lib/products/saved-setups/saved-custom-items-service";
import { listSetupsForUser } from "@/lib/products/saved-setups/saved-setups-service";
import { parseCollectionTab } from "@/lib/products/saved-setups/shares";
import { countPendingIncoming } from "@/lib/products/saved-setups/shares-service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Private, owner-only list (any active user). Reads run under the caller's RLS and are also filtered by owner.
// ?tab=configured|custom|shared|sent picks the first tab (anything else is "configured"). In this Next.js version
// searchParams is a Promise.
export default async function MyCollectionPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { user, profile, displayName } = await requireActiveUser();
  const supabase = await createClient();
  const [items, customItems, pending, params] = await Promise.all([
    listSetupsForUser(supabase, user.id),
    listCustomItemsForUser(supabase, user.id),
    countPendingIncoming(supabase, user.id),
    searchParams,
  ]);
  const initialTab = parseCollectionTab(params.tab);

  return (
    <ErpAppShell
      title="My Collection"
      description="Your saved product setups. Prices are always recalculated from the current price lists when you use one."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <MyCollectionTabs items={items} customItems={customItems} initialTab={initialTab} pendingShares={pending.ok ? pending.count : 0} />
    </ErpAppShell>
  );
}
