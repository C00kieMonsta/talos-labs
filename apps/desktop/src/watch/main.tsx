import React from "react";
import ReactDOM from "react-dom/client";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/components.css";
import "../styles/watch.css";
import { DemoWatch } from "../adapters/demo-watch";
import { TauriWatchAdapter } from "../adapters/tauri-watch";
import { parseWatchDemoQuery } from "../app/demo-boot";
import { WatchWindow } from "./WatchWindow";
import type { WatchWindowPort } from "./WatchWindow";

// Demo mode is a build-time choice, as in app/container.ts. The real window gets the limited adapter: four commands, nothing else.
// The window exists only while the watch is active, so the demo window is always licensed.
const port: WatchWindowPort =
  import.meta.env.VITE_TALOS_DEMO === "1"
    ? new DemoWatch({ ...parseWatchDemoQuery(new URLSearchParams(window.location.search)), licensed: true })
    : new TauriWatchAdapter({ limited: true });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WatchWindow port={port} />
  </React.StrictMode>,
);
