/// <reference types="vite/client" />

/** YYYY-MM-DD, injected by Vite define at build time. */
declare const __BUILD_DATE__: string;

interface ImportMetaEnv {
  /** "1" only in the browser-only demo build. Read at build time; never a runtime flag. */
  readonly VITE_TALOS_DEMO?: string;
}

/** What the demo adapters would have opened. */
interface TalosDemoCall {
  readonly kind:
    | "openSettingsPane"
    | "openBuyPage"
    | "restart"
    | "fixPreview"
    | "fixApply"
    | "fixCancel"
    | "fixReveal"
    | "fixPreviewBatch"
    | "fixApplyBatch"
    | "aiCancel";
  readonly arg?: string | readonly string[];
  readonly prompt?: string;
}

interface Window {
  /** Present only in demo mode. */
  __talosDemoCalls?: TalosDemoCall[];
  /** Demo mode only: scales the Scanning reveal schedule; 0 collapses it. */
  __talosDemoPace?: number;
}
