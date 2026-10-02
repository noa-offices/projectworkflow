export type PriceCheckTemplate = {
  creation_legacy?: boolean;
  brand_price_check_interval_days?: number | null;
  scheduled_brand_price_list_update?: BrandPriceListUpdateForCheck | null;
  created_at: string | null;
  last_price_checked_at: string | null;
  price_check_interval_days: number | null;
};

export type BrandPriceListUpdateForCheck = {
  coverage_mode?: string;
  title?: string | null;
  effective_from: string | null;
  received_at: string | null;
  created_at: string | null;
  status: string;
};

export type ProductPriceCheckState = {
  scheduledEffectiveFrom?: string | null;
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
  if (!update || update.status !== "active" || !["complete", "legacy"].includes(update.coverage_mode ?? "")) {
    return null;
  }

  return update.effective_from ?? update.received_at ?? update.created_at ?? null;
}

export function brandPriceBaselineDate({
  fallbackCheckedAt,
  latestBrandPriceListUpdate,
  now = Date.now(),
}: {
  now?: number;
  fallbackCheckedAt?: string | null;
  latestBrandPriceListUpdate?: BrandPriceListUpdateForCheck | null;
}) {
  const updateDate = brandPriceListUpdateDate(latestBrandPriceListUpdate);
  if (isEffective(updateDate, now)) return updateDate;
  // This field is retained exclusively as historical legacy evidence.
  return isEffective(fallbackCheckedAt, now) ? fallbackCheckedAt ?? null : null;
}

function isEffective(value: string | null | undefined, now: number) {
  const time = dateMs(value);
  const key = dateKey(value);
  return time !== null && key !== null && key <= new Date(now).toISOString().slice(0, 10);
}

export function latestBrandPriceListUpdate<T extends BrandPriceListUpdateForCheck>(updates: T[], now = Date.now()) {
  const eligible = updates.filter((update) => isEffective(brandPriceListUpdateDate(update), now));
  const complete = eligible.filter((update) => update.coverage_mode === "complete");
  return (complete.length ? complete : eligible.filter((update) => update.coverage_mode === "legacy"))
    .reduce<T | null>((latest, update) => {
      const updateTime = dateMs(brandPriceListUpdateDate(update));
      const latestTime = dateMs(brandPriceListUpdateDate(latest));

      if (updateTime === null) return latest;
      if (latestTime === null || updateTime > latestTime) return update;

      return latest;
    }, null);
}

export function scheduledBrandPriceListUpdate<T extends BrandPriceListUpdateForCheck>(updates: T[], now = Date.now()) {
  return updates.filter((update) => update.status === "active" && update.coverage_mode === "complete")
    .filter((update) => dateMs(brandPriceListUpdateDate(update)) !== null && !isEffective(brandPriceListUpdateDate(update), now))
    .reduce<T | null>((next, update) => !next || dateMs(brandPriceListUpdateDate(update))! < dateMs(brandPriceListUpdateDate(next))! ? update : next, null);
}

export function productTemplatePriceCheckState({
  brandPriceCheckIntervalDays,
  brandPriceBaselineAt,
  formatDate,
  latestBrandPriceListUpdate,
  scheduledBrandPriceListUpdate: scheduledUpdate,
  now = Date.now(),
  template,
}: {
  brandPriceCheckIntervalDays?: number | null;
  brandPriceBaselineAt?: string | null;
  formatDate: (value: string | null) => string;
  latestBrandPriceListUpdate?: BrandPriceListUpdateForCheck | null;
  scheduledBrandPriceListUpdate?: BrandPriceListUpdateForCheck | null;
  now?: number;
  template: PriceCheckTemplate;
}): ProductPriceCheckState {
  const scheduled = scheduledUpdate ?? template.scheduled_brand_price_list_update ??
    (latestBrandPriceListUpdate && !isEffective(brandPriceListUpdateDate(latestBrandPriceListUpdate), now) ? latestBrandPriceListUpdate : null);
  const scheduledDate = scheduled?.status === "active" && scheduled.coverage_mode === "complete"
    ? brandPriceListUpdateDate(scheduled) : null;
  const finish = (state: ProductPriceCheckState): ProductPriceCheckState => scheduledDate && !isEffective(scheduledDate, now)
    ? { ...state, scheduledEffectiveFrom: scheduledDate, detail: `${state.detail} New complete price list scheduled for ${formatDate(scheduledDate)}.` }
    : state;
  const brandInterval = brandPriceCheckIntervalDays ?? template.brand_price_check_interval_days;
  const intervalDays = template.price_check_interval_days && template.price_check_interval_days > 0
    ? template.price_check_interval_days
    : brandInterval && brandInterval > 0 ? brandInterval : 90;
  const latestBrandUpdateDate = brandPriceBaselineDate({
    fallbackCheckedAt: brandPriceBaselineAt,
    latestBrandPriceListUpdate,
    now,
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
    return finish({
      detail: "No brand price list date recorded yet.",
      key: "no_price_list_date",
      tone: "neutral",
      label: "No price list date",
      reason: "No brand latest price list date is recorded.",
    });
  }

  if (checkedOnOrAfterBaseline) {
    if (checkedAt !== null) {
      const dueAt = checkedAt + intervalDays * dayMs;

      if (dueAt < now) {
        return finish({
          detail: `Last checked: ${formatDate(template.last_price_checked_at)}`,
          key: "due",
          tone: "warning",
          label: "Price check due",
          reason: "Template was checked against the latest brand price list, but its scheduled recheck is now due.",
        });
      }

      return finish({
        detail: "Checked against latest brand price list.",
        key: "checked",
        tone: "ok",
        label: "Price checked",
        reason: "Checked against latest brand price list.",
      });
    }
  }

  const completeBaseline = latestBrandPriceListUpdate?.coverage_mode === "complete" &&
    isEffective(brandPriceListUpdateDate(latestBrandPriceListUpdate), now);
  // Grandfathered display is not a review. An explicit check or effective complete
  // source supersedes it; no artificial date/actor is manufactured for expiry.
  if (template.creation_legacy && !template.last_price_checked_at && !completeBaseline && createdOnOrAfterBaseline) {
    return finish({
      detail: "Historical creation compatibility; not an explicit price check.",
      key: "current",
      tone: "ok",
      label: "Price current",
      reason: "creation_legacy: preserved until an explicit check or eligible list update supersedes it.",
    });
  }

  return finish({
    detail: "Template has not been checked against the current brand price list.",
    key: "needs_check",
    tone: "warning",
    label: "Needs price check",
    reason: "No explicit template check against the current baseline.",
  });
}
