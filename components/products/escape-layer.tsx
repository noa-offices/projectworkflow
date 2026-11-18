"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";

// Escape inside the My Collection popup closes the INNERMOST open thing first (an edit panel, a rename, a delete confirm)
// and closes the popup only when nothing inside is open. Inner pieces register themselves while they are open with
// useEscapeLayer; the popup asks closeTop() on Escape. Outside the popup there is no registry and nothing happens, so the
// same components behave as before on the My Collection page.
type EscapeLayers = { push: (close: () => void) => () => void };
const EscapeLayerContext = createContext<EscapeLayers | null>(null);
export const EscapeLayerProvider = EscapeLayerContext.Provider;

/** Popup side: the registry value for the provider, and closeTop() which returns true when it closed something inside. */
export function useEscapeLayerRegistry() {
  const stack = useRef<Array<() => void>>([]);
  const layers = useMemo<EscapeLayers>(() => ({
    push(close) {
      stack.current.push(close);
      return () => {
        const index = stack.current.lastIndexOf(close);
        if (index >= 0) stack.current.splice(index, 1);
      };
    },
  }), []);
  const closeTop = useCallback(() => {
    const top = stack.current[stack.current.length - 1];
    if (!top) return false;
    top();
    return true;
  }, []);
  return { layers, closeTop };
}

/** Inner side: while `active`, Escape inside the popup calls `close` instead of closing the popup. */
export function useEscapeLayer(active: boolean, close: () => void) {
  const layers = useContext(EscapeLayerContext);
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!active || !layers) return;
    return layers.push(() => closeRef.current());
  }, [active, layers]);
}
