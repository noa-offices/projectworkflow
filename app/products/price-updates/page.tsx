import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { PriceUpdatesReview, type PriceUpdatesReviewRow } from "@/components/products/price-updates-review";
import { requireProductPricingManager } from "@/lib/auth";
import { formatMoney } from "@/lib/currencies";
import { brandPriceBaselineDate, latestBrandPriceListUpdate, productTemplatePriceCheckState } from "@/lib/product-price-check";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PriceUpdatesSearchParams = {
  brand?: string | string[];
  currency?: string | string[];
  q?: string | string[];
  status?: string | string[];
};

type PriceUpdatesPageProps = {
  searchParams?: Promise<PriceUpdatesSearchParams>;
};

type Brand = {
  id: string;
  default_currency: string | null;
  last_price_list_checked_at: string | null;
  name: string;
  price_list_check_interval_days: number | null;
  price_list_check_note: string | null;
};

type Category = {
  id: string;
  brand_id: string;
  name: string;
  parent_id: string | null;
};

type ProductTemplate = {
  id: string;
  brand_id: string;
  created_at: string | null;
  currency: string;
  default_unit_price: number;
  description: string | null;
  item_code: string | null;
  last_price_checked_at: string | null;
  main_category_id: string | null;
  price_check_interval_days: number | null;
  price_check_note: string | null;
  sub_category_id: string | null;
  template_code: string | null;
  template_name: string;
};

type BrandPriceListUpdate = {
  id: string;
  brand_id: string;
  created_at: string | null;
  effective_from: string | null;
  received_at: string | null;
  status: string;
  title: string | null;
};

function stringParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not set";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function templateSearchText(template: ProductTemplate, brandName: string, categoryName: string) {
  return [
    template.template_name,
    template.template_code,
    template.item_code,
    template.description,
    brandName,
    categoryName,
    template.currency,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default async function PriceUpdatesPage({ searchParams }: PriceUpdatesPageProps) {
  const { user, profile, displayName } = await requireProductPricingManager();
  const params = (await searchParams) ?? {};
  const searchQuery = stringParam(params.q).trim();
  const selectedBrand = stringParam(params.brand);
  const selectedStatus = stringParam(params.status);
  const selectedCurrency = stringParam(params.currency);
  const supabase = await createClient();

  const { data: brands, error: brandsError } = await supabase
    .from("brands")
    .select("id,name,default_currency,last_price_list_checked_at,price_list_check_interval_days,price_list_check_note")
    .eq("is_active", true)
    .order("name", { ascending: true })
    .returns<Brand[]>();

  const { data: categories, error: categoriesError } = await supabase
    .from("product_categories")
    .select("id,brand_id,parent_id,name")
    .eq("is_active", true)
    .order("brand_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<Category[]>();

  const { data: templates, error: templatesError } = await supabase
    .from("product_templates")
    .select("id,brand_id,main_category_id,sub_category_id,template_code,template_name,item_code,description,currency,default_unit_price,last_price_checked_at,price_check_interval_days,price_check_note,created_at")
    .eq("is_active", true)
    .order("brand_id", { ascending: true })
    .order("template_name", { ascending: true })
    .returns<ProductTemplate[]>();

  const { data: priceListUpdates, error: priceListUpdatesError } = await supabase
    .from("brand_price_list_updates")
    .select("id,brand_id,title,effective_from,received_at,created_at,status")
    .in("status", ["draft", "active"])
    .order("effective_from", { ascending: false, nullsFirst: false })
    .order("received_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .returns<BrandPriceListUpdate[]>();

  if (brandsError) console.error("PRICE UPDATES BRANDS ERROR", brandsError.message);
  if (categoriesError) console.error("PRICE UPDATES CATEGORIES ERROR", categoriesError.message);
  if (templatesError) console.error("PRICE UPDATES TEMPLATES ERROR", templatesError.message);
  if (priceListUpdatesError) console.error("PRICE UPDATES PRICE LIST ERROR", priceListUpdatesError.message);

  const brandList = brands ?? [];
  const categoryList = categories ?? [];
  const templateList = templates ?? [];
  const priceListUpdateList = priceListUpdates ?? [];
  const brandById = new Map(brandList.map((brand) => [brand.id, brand]));
  const categoryById = new Map(categoryList.map((category) => [category.id, category]));
  const latestPriceListUpdateByBrand = new Map<string, BrandPriceListUpdate | null>();
  const brandPriceBaselineByBrand = new Map<string, string | null>();

  for (const brand of brandList) {
    const latestUpdate = latestBrandPriceListUpdate(priceListUpdateList.filter((update) => update.brand_id === brand.id));
    latestPriceListUpdateByBrand.set(brand.id, latestUpdate);
    brandPriceBaselineByBrand.set(
      brand.id,
      brandPriceBaselineDate({
        fallbackCheckedAt: brand.last_price_list_checked_at,
        latestBrandPriceListUpdate: latestUpdate,
      }),
    );
  }

  const reviewRows = templateList.map<PriceUpdatesReviewRow>((template) => {
    const brand = brandById.get(template.brand_id);
    const mainCategory = template.main_category_id ? categoryById.get(template.main_category_id)?.name ?? "" : "";
    const subCategory = template.sub_category_id ? categoryById.get(template.sub_category_id)?.name ?? "" : "";
    const categoryName = [mainCategory, subCategory].filter(Boolean).join(" / ") || "No category";
    const status = productTemplatePriceCheckState({
      brandPriceBaselineAt: brandPriceBaselineByBrand.get(template.brand_id),
      formatDate,
      latestBrandPriceListUpdate: latestPriceListUpdateByBrand.get(template.brand_id),
      template,
    });

    return {
      brandName: brand?.name ?? "Unknown brand",
      categoryName,
      editHref: `/products/manage?template=${template.id}&editTemplate=${template.id}`,
      id: template.id,
      lastPriceListDateLabel: formatDate(brandPriceBaselineByBrand.get(template.brand_id)),
      priceStatusDetail: status.detail,
      priceStatusKey: status.key,
      priceStatusLabel: status.label,
      priceStatusTone: status.tone,
      searchText: templateSearchText(template, brand?.name ?? "", categoryName),
      sourceCurrency: template.currency,
      sourcePriceLabel: formatMoney(template.currency, template.default_unit_price),
      templateCodeLabel: [template.template_code, template.item_code].filter(Boolean).join(" / ") || "No template or item code",
      templateName: template.template_name,
      viewHref: `/products?template=${template.id}`,
    };
  });

  return (
    <ErpAppShell
      title="Price Updates"
      description="Review product templates due for source price checks and price-list follow-up."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <PriceUpdatesReview
        initialFilters={{
          brand: selectedBrand,
          currency: selectedCurrency,
          query: searchQuery,
          status: selectedStatus,
        }}
        rows={reviewRows}
      />
    </ErpAppShell>
  );
}
