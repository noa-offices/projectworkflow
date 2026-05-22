export type PriceCheckTemplate = {
  created_at: string | null;
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
  key: "no_price_list_date" | "current" | "needs_check" | "due" | "scheduled" | "checked";
  label: string;
  reason: string;
  tone: "warning" | "notice" | "ok" | "neutral";
};

const dayMs = 24 * 60 * 60 * 1000;

function dateMs(value: string | null | undefined) {
  if (!value) return null;

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function dateKey(value: string | null | undefined) {
  if (!value) return null;

  const exactDate = value.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (exactDate) {
    return exactDate;
  }

  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) {
    return null;
  }

  return time.toISOString().slice(0, 10);
}

export function brandPriceListUpdateDate(update: BrandPriceListUpdateForCheck | null | undefined) {
  if (!update || (update.status !== "draft" && update.status !== "active")) {
    return null;
  }

  return update.effective_from ?? update.received_at ?? update.created_at ?? null;
}

export function brandPriceBaselineDate({
  fallbackCheckedAt,
  latestBrandPriceListUpdate,
}: {
  fallbackCheckedAt?: string | null;
  latestBrandPriceListUpdate?: BrandPriceListUpdateForCheck | null;
}) {
  return brandPriceListUpdateDate(latestBrandPriceListUpdate) ?? fallbackCheckedAt ?? null;
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
  brandPriceBaselineAt,
  formatDate,
  latestBrandPriceListUpdate,
  now = Date.now(),
  template,
}: {
  brandPriceBaselineAt?: string | null;
  formatDate: (value: string | null) => string;
  latestBrandPriceListUpdate?: BrandPriceListUpdateForCheck | null;
  now?: number;
  template: PriceCheckTemplate;
}): ProductPriceCheckState {
  const intervalDays = template.price_check_interval_days && template.price_check_interval_days > 0
    ? template.price_check_interval_days
    : 90;
  const latestBrandUpdateDate = brandPriceBaselineDate({
    fallbackCheckedAt: brandPriceBaselineAt,
    latestBrandPriceListUpdate,
  });
  const latestBrandUpdateTime = dateMs(latestBrandUpdateDate);
  const latestBrandUpdateDateKey = dateKey(latestBrandUpdateDate);
  const createdDateKey = dateKey(template.created_at);
  const checkedAt = dateMs(template.last_price_checked_at);
  const checkedDateKey = dateKey(template.last_price_checked_at);
  const createdOnOrAfterBaseline = Boolean(
    createdDateKey &&
    latestBrandUpdateDateKey &&
    createdDateKey >= latestBrandUpdateDateKey,
  );
  const checkedOnOrAfterBaseline = Boolean(
    checkedDateKey &&
    latestBrandUpdateDateKey &&
    checkedDateKey >= latestBrandUpdateDateKey,
  );

  if (latestBrandUpdateDateKey === null || latestBrandUpdateTime === null) {
    return {
      detail: "No brand price list date recorded yet.",
      key: "no_price_list_date",
      tone: "neutral",
      label: "No price list date",
      reason: "No brand latest price list date is recorded.",
    };
  }

  if (latestBrandUpdateTime > now) {
    return {
      detail: `Effective from: ${formatDate(latestBrandUpdateDate)}`,
      key: "scheduled",
      tone: "notice",
      label: "New price list scheduled",
      reason: "Brand latest price list date is in the future.",
    };
  }

  if (checkedOnOrAfterBaseline) {
    if (checkedAt !== null) {
      const dueAt = checkedAt + intervalDays * dayMs;

      if (dueAt < now) {
        return {
          detail: `Last checked: ${formatDate(template.last_price_checked_at)}`,
          key: "due",
          tone: "warning",
          label: "Price check due",
          reason: "Template was checked against the latest brand price list, but its scheduled recheck is now due.",
        };
      }

      return {
        detail: "Checked against latest brand price list.",
        key: "checked",
        tone: "ok",
        label: "Price checked",
        reason: "Checked against latest brand price list.",
      };
    }
  }

  if (createdOnOrAfterBaseline) {
    return {
      detail: "Added after latest brand price list date.",
      key: "current",
      tone: "ok",
      label: "Price current",
      reason: "Added after latest brand price list date.",
    };
  }

  return {
    detail: `Brand price list was updated after this template${checkedAt !== null ? " was last checked" : " was created"}.`,
    key: "needs_check",
    tone: "warning",
    label: "Needs price check",
    reason: "Brand price list was updated after this template was created or last checked.",
  };
}
