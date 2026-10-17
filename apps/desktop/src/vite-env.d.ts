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
    | "aiCancel"
    | "aiConnectStart"
    | "aiConnectCancel"
    | "aiDisconnect"
    | "watch_check_now"
    | "watch_pause"
    | "watch_acknowledge"
    | "watch_answer_gate"
    | "watch_snooze"
    | "watch_set_enabled"
    | "watch_set_interval"
    | "watch_set_notify"
    | "watch_set_profile"
    | "watch_request_notify_permission"
    | "watch_action_preview"
    | "watch_action_apply"
    | "watch_open_source"
    | "watch_open_main"
    | "autostart_enable"
    | "autostart_disable"
    | "watch:notified"
    | "chat";
  /** A rule, signal, action or watch.* id, a boolean or a number; never a URL, a path or profile text. */
  readonly arg?: string | number | boolean | readonly string[];
  readonly prompt?: string;
}

interface Window {
  /** Present only in demo mode. */
  __talosDemoCalls?: TalosDemoCall[];
  /** Demo mode only: scales the Scanning reveal schedule; 0 collapses it. */
  __talosDemoPace?: number;
  /** Demo mode only: chat_divider=1 dates the chat's opening this far back, so the next message draws the time divider. */
  __talosDemoChat?: { readonly openingAgoMs: number };
}
