export const GLOBAL_LOADING_EVENT = "projectworkflow:global-loading";

export type GlobalLoadingSource = "navigation" | "action";

type GlobalLoadingEventDetail = {
  action: "start" | "stop";
  source?: GlobalLoadingSource;
};

function dispatchGlobalLoading(detail: GlobalLoadingEventDetail) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<GlobalLoadingEventDetail>(GLOBAL_LOADING_EVENT, {
      detail,
    }),
  );
}

export function startGlobalLoading(source: GlobalLoadingSource = "action") {
  dispatchGlobalLoading({ action: "start", source });
}

export function stopGlobalLoading() {
  dispatchGlobalLoading({ action: "stop" });
}
