export type PriceCheckTemplate = {
  last_price_checked_at: string | null;
  price_check_interval_days: number | null;
};

export type BrandPriceListUpdateForCheck = {
  title?: string | null;
  effective_from: string | null;
  received_at: string | null;
  created_at: string | null;
  status: string;
};

export type ProductPriceCheckState = {
  detail: string;
  key: "not_checked" | "due" | "scheduled" | "checked";
  label: string;
  tone: "warning" | "notice" | "ok";
};

const dayMs = 24 * 60 * 60 * 1000;

function dateMs(value: string | null | undefined) {
  if (!value) return null;

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function brandPriceListUpdateDate(update: BrandPriceListUpdateForCheck | null | undefined) {
  if (!update || (update.status !== "draft" && update.status !== "active")) {
    return null;
  }

  return update.effective_from ?? update.received_at ?? update.created_at ?? null;
}

export function latestBrandPriceListUpdate<T extends BrandPriceListUpdateForCheck>(updates: T[]) {
  return updates
    .filter((update) => update.status === "draft" || update.status === "active")
    .reduce<T | null>((latest, update) => {
      const updateTime = dateMs(brandPriceListUpdateDate(update));
      const latestTime = dateMs(brandPriceListUpdateDate(latest));

      if (updateTime === null) return latest;
      if (latestTime === null || updateTime > latestTime) return update;

      return latest;
    }, null);
}

export function productTemplatePriceCheckState({
  brandName,
  formatDate,
  latestBrandPriceListUpdate,
  now = Date.now(),
  template,
}: {
  brandName?: string | null;
  formatDate: (value: string | null) => string;
  latestBrandPriceListUpdate?: BrandPriceListUpdateForCheck | null;
  now?: number;
  template: PriceCheckTemplate;
}): ProductPriceCheckState {
  const intervalDays = template.price_check_interval_days && template.price_check_interval_days > 0
    ? template.price_check_interval_days
    : 90;
  const latestBrandUpdateDate = brandPriceListUpdateDate(latestBrandPriceListUpdate);
  const latestBrandUpdateTime = dateMs(latestBrandUpdateDate);
  const checkedAt = dateMs(template.last_price_checked_at);
  const brandLabel = brandName ? `${brandName} price list` : "brand price list";

  if (!template.last_price_checked_at || checkedAt === null) {
    return {
      detail: "No check recorded",
      key: "not_checked",
      tone: "warning",
      label: "Price not checked yet",
    };
  }

  if (latestBrandUpdateTime !== null && checkedAt < latestBrandUpdateTime) {
    if (latestBrandUpdateTime > now) {
      return {
        detail: `Effective from: ${formatDate(latestBrandUpdateDate)}`,
        key: "scheduled",
        tone: "notice",
        label: "New price list scheduled",
      };
    }

    return {
      detail: `New ${brandLabel} effective from ${formatDate(latestBrandUpdateDate)}`,
      key: "due",
      tone: "warning",
      label: "Price check due",
    };
  }

  const dueAt = checkedAt + intervalDays * dayMs;

  if (dueAt < now) {
    return {
      detail: `Last checked: ${formatDate(template.last_price_checked_at)}`,
      key: "due",
      tone: "warning",
      label: "Price check due",
    };
  }

  return {
    detail: `Price checked: ${formatDate(template.last_price_checked_at)}`,
    key: "checked",
    tone: "ok",
    label: "Price checked",
  };
}
