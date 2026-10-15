import type { SystemState } from "../domain/system-state";
import { ALL_UNAVAILABLE } from "./all-unavailable";
import { DEV_MACHINE } from "./dev-machine";
import { FRESH_INSTALL } from "./fresh-install";
import { HARDENED } from "./hardened";
import { WINDOWS_MINIMAL } from "./windows-minimal";

/** Every fixture by its JSON file name under packages/core/fixtures. */
export const FIXTURES: Readonly<Record<string, SystemState>> = {
  "dev-machine": DEV_MACHINE,
  hardened: HARDENED,
  "all-unavailable": ALL_UNAVAILABLE,
  "fresh-install": FRESH_INSTALL,
  "windows-minimal": WINDOWS_MINIMAL,
};

export { ALL_UNAVAILABLE, DEV_MACHINE, FRESH_INSTALL, HARDENED, WINDOWS_MINIMAL };
