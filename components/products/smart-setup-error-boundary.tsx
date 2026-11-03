"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/** Keeps a render crash inside Smart Setup from leaving a dead window. Close remounts the importer with fresh state. */
export class SmartSetupErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Smart Setup crashed", error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div role="alertdialog" aria-modal="true" aria-label="Smart Setup problem" className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-red-800">Smart Setup hit a problem</h2>
        <p className="mt-2 text-sm text-zinc-700">This window cannot be shown. Your Product Template was not changed. Close it and try again.</p>
        <details className="mt-2 text-xs text-zinc-600"><summary className="cursor-pointer">Details</summary><p className="mt-1 break-words font-mono">{this.state.error.message}</p></details>
        <div className="mt-4 flex justify-end"><button type="button" onClick={() => this.setState({ error: null })} className="rounded-md bg-emerald-900 px-3 py-2 text-sm font-semibold text-white">Close</button></div>
      </div>
    </div>;
  }
}
