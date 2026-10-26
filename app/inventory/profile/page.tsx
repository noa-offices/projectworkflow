import { ProfileView } from "@/components/inventory/profile-view";
import { requireInventoryUser } from "@/lib/auth";
import { profileDisplayName, profileRoleLabel, showFullProfileLink } from "@/lib/inventory/profile";

export const dynamic = "force-dynamic";

/** Uses requireInventoryUser (as the layout does), so Warehouse Staff can open this page and nothing else outside Inventory. */
export default async function InventoryProfilePage() {
  const { user, profile } = await requireInventoryUser();
  return <ProfileView userId={user.id} displayName={profileDisplayName(profile?.full_name)} email={profile?.email ?? user.email ?? ""} roleLabel={profileRoleLabel(profile?.role)} fullName={profile?.full_name ?? ""} phone={profile?.phone ?? ""} avatarUrl={profile?.avatar_url ?? null} showFullProfileLink={showFullProfileLink(profile?.role)} />;
}
