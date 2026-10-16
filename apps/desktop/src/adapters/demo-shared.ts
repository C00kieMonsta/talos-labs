import type { AbortSignalLike } from "@talos/core";

export function cancelled(): Error {
  return new Error("cancelled");
}

/** Resolves after ms, or rejects with "cancelled" as soon as the signal aborts. */
export function wait(ms: number, signal?: AbortSignalLike): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort);
  });
}

/** Records what the app would have done, for a QA script to read back. */
export function recordDemoCall(call: TalosDemoCall): void {
  if (typeof window === "undefined") return;
  const calls = window.__talosDemoCalls ?? [];
  calls.push(call);
  window.__talosDemoCalls = calls;
}
