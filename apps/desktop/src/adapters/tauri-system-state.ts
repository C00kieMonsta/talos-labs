import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  ALL_UNAVAILABLE,
  SECTION_KEYS,
  assertSystemState,
  toCapabilities,
  type AbortSignalLike,
  type Capabilities,
  type CollectOptions,
  type CollectSectionOptions,
  type SectionKey,
  type SectionProgress,
  type SystemState,
  type SystemStatePort,
  type SystemStateSections,
} from "@talos/core";

export type ScanErrorKind = "cancelled" | "timeout" | "collector_crashed" | "schema_mismatch";

/** Thrown by collect() so the scan machine can branch on kind without string matching. */
export class ScanError extends Error {
  readonly kind: ScanErrorKind;
  constructor(kind: ScanErrorKind, message: string) {
    super(message);
    this.name = "ScanError";
    this.kind = kind;
  }
}

const PROGRESS_STATUSES: readonly SectionProgress["status"][] = ["started", "ok", "unavailable"];

function isSectionKey(value: unknown): value is SectionKey {
  return typeof value === "string" && (SECTION_KEYS as readonly string[]).includes(value);
}

function toProgress(payload: unknown): SectionProgress | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { key, status } = payload as { key?: unknown; status?: unknown };
  if (!isSectionKey(key)) return null;
  if (typeof status !== "string" || !(PROGRESS_STATUSES as readonly string[]).includes(status)) return null;
  return { key, status: status as SectionProgress["status"] };
}

function toScanError(error: unknown): ScanError {
  if (error instanceof ScanError) return error;
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
  if (text === "cancelled") return new ScanError("cancelled", text);
  if (text === "timeout") return new ScanError("timeout", text);
  return new ScanError("collector_crashed", text);
}

function toSchemaError(error: unknown): ScanError {
  const detail = error instanceof Error ? error.message : String(error);
  return new ScanError("schema_mismatch", `schema mismatch: ${detail}`);
}

function cancelledError(): ScanError {
  return new ScanError("cancelled", "cancelled");
}

/**
 * Settles with `pending`, or rejects with cancelled the moment `signal` aborts.
 * The abort is forwarded to cancel_section, which leaves a scan started alongside it alone; a late answer from the command is dropped.
 */
function untilAbort<T>(pending: Promise<T>, signal: AbortSignalLike | undefined): Promise<T> {
  if (signal === undefined) return pending;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      void invoke("cancel_section").catch(() => undefined);
      reject(cancelledError());
    };
    signal.addEventListener("abort", onAbort);
    void pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** A failed subscription only loses progress updates; the scan itself still runs. */
async function subscribeProgress(onProgress: (progress: SectionProgress) => void): Promise<UnlistenFn | null> {
  try {
    return await listen<unknown>("scan:progress", (event) => {
      const progress = toProgress(event.payload);
      if (progress) onProgress(progress);
    });
  } catch {
    return null;
  }
}

export class TauriSystemStateAdapter implements SystemStatePort {
  async collect(options?: CollectOptions): Promise<SystemState> {
    const signal = options?.signal;
    const onProgress = options?.onProgress;
    if (signal?.aborted) throw cancelledError();

    const unlisten = onProgress ? await subscribeProgress(onProgress) : null;

    const onAbort = () => {
      void invoke("cancel_scan").catch(() => undefined);
    };
    signal?.addEventListener("abort", onAbort);

    try {
      let raw: unknown;
      try {
        raw = await invoke<unknown>("collect_system_state");
      } catch (error) {
        throw toScanError(error);
      }
      try {
        assertSystemState(raw);
      } catch (error) {
        throw toSchemaError(error);
      }
      return raw;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      unlisten?.();
    }
  }

  async collectSection<K extends SectionKey>(key: K, options?: CollectSectionOptions): Promise<SystemStateSections[K]> {
    const signal = options?.signal;
    if (signal?.aborted) throw cancelledError();
    let raw: unknown;
    try {
      raw = await untilAbort(invoke<unknown>("collect_section", { key }), signal);
    } catch (error) {
      throw toScanError(error);
    }
    // Splice the section into a known-good state so the full guard validates it.
    const probe: unknown = {
      ...ALL_UNAVAILABLE,
      sections: { ...ALL_UNAVAILABLE.sections, [key]: raw },
    };
    try {
      assertSystemState(probe);
    } catch (error) {
      throw toSchemaError(error);
    }
    return probe.sections[key];
  }

  async capabilities(): Promise<Capabilities> {
    return toCapabilities(await invoke<unknown>("check_capabilities"));
  }
}
