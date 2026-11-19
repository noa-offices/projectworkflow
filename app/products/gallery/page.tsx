import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { ProductGalleryBrowser } from "@/components/products/product-gallery-browser";
import { requireActiveUser } from "@/lib/auth";
import { getGalleryCapabilitiesAction } from "@/lib/products/gallery/gallery-actions";
import { parseGalleryQuery } from "@/lib/products/gallery/gallery-view";

export const dynamic = "force-dynamic";

// Product Gallery: configured products the company has quoted. The capabilities are checked FIRST; without access nothing else is
// read. Filters come from the URL query string (in this Next.js version searchParams is a Promise) and are validated by the parser.
export default async function ProductGalleryPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { user, profile, displayName } = await requireActiveUser();
  const capabilities = await getGalleryCapabilitiesAction();
  const canView = capabilities.ok && capabilities.canView;
  const canEdit = capabilities.ok && capabilities.canView && capabilities.canEdit;
  const canCurate = capabilities.ok && capabilities.canView && capabilities.canCurate;
  const params = await searchParams;
  const initialState = parseGalleryQuery((key) => params[key]);

  return (
    <ErpAppShell
      title="Product Gallery"
      description="Configured products that your company has quoted. They grow by themselves."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      {canView ? (
        <ProductGalleryBrowser canEdit={canEdit} canCurate={canCurate} initialState={initialState} />
      ) : (
        <p role="alert" className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-700">
          {capabilities.ok ? "You do not have access to the gallery." : capabilities.message}
        </p>
      )}
    </ErpAppShell>
  );
}
