import React from "react";
import ReactDOM from "react-dom/client";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/components.css";
import "../styles/watch.css";
import { DemoWatch } from "../adapters/demo-watch";
import { TauriWatchAdapter } from "../adapters/tauri-watch";
import { parseWatchDemoQuery } from "../app/demo-boot";
import { connectOffer } from "./connect-offer";
import { WatchWindow } from "./WatchWindow";
import type { WatchWindowPort } from "./WatchWindow";

// Demo mode is a build-time choice, as in app/container.ts. The real window gets the limited adapter: four commands, nothing else.
// The window exists only while the watch is active, so the demo window is always licensed.
const demo = import.meta.env.VITE_TALOS_DEMO === "1";
const flags = demo ? { ...parseWatchDemoQuery(new URLSearchParams(window.location.search)), licensed: true } : null;
const port: WatchWindowPort = flags !== null ? new DemoWatch(flags) : new TauriWatchAdapter({ limited: true });
// The Connect line reads the main window's settings and guided memory from the shared origin; the demo answers from its flag.
const offer = flags !== null ? () => flags.watch === "not-connected" : () => connectOffer(window.localStorage, new Date().toISOString());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WatchWindow port={port} connectOffer={offer} />
  </React.StrictMode>,
);
