import type { WatchInterval } from "@talos/core";
import { WATCH_INTERVALS } from "@talos/core";
import { useApp } from "../app/context";
import type { Route } from "../app/router";
import { Segmented } from "../components/ProfileForm";
import { COVERAGE, NOT_ANTIVIRUS, WATCH_SETTINGS } from "../guided/copy";
import { useWatchController } from "../watch/watch-controller";
import { Section, Switch } from "./YourAiSection";

/** "What I watch" from Settings, returning here on Back. */
const COVERAGE_ROUTE: Route = { name: "coverage", returnTo: { name: "settings" } };

export const INTERVAL_LABELS: Readonly<Record<WatchInterval, string>> = {
  15: WATCH_SETTINGS.every15,
  60: WATCH_SETTINGS.every60,
  240: WATCH_SETTINGS.every240,
};

/** The Watch section, first in Settings. Checked state is the settings cache; the controller writes it back after the port answers. */
export function WatchSection() {
  const { settings, router } = useApp();
  const watch = useWatchController();
  const { enabled, startAtLogin, everyMinutes, notify } = settings.watch;
  const setNotify = async (next: boolean) => {
    // The permission alert is asked for here, from the welcome button and from the paste that activates the watch; the controller records it.
    if (next) await watch.requestNotifyPermission().catch(() => undefined);
    await watch.setNotify(next).catch(() => undefined);
  };
  return (
    <Section id="watch" title={WATCH_SETTINGS.title}>
      <Switch label={WATCH_SETTINGS.enabled} description={WATCH_SETTINGS.sentence} checked={enabled} onChange={(next) => void watch.setEnabled(next).catch(() => undefined)} />
      <Switch label={WATCH_SETTINGS.startAtLogin} description={WATCH_SETTINGS.startAtLoginDescription} checked={startAtLogin} onChange={(next) => void watch.setStartAtLogin(next).catch(() => undefined)} />
      <Segmented legend={WATCH_SETTINGS.howOften} name="watch-interval" options={WATCH_INTERVALS} labels={INTERVAL_LABELS} value={everyMinutes} onChange={(minutes) => void watch.setInterval(minutes).catch(() => undefined)} />
      <Switch label={WATCH_SETTINGS.notify} description={WATCH_SETTINGS.notifyDescription} checked={notify} onChange={(next) => void setNotify(next)} />
      <p className="muted">{NOT_ANTIVIRUS}</p>
      <button type="button" className="guided-link watch-coverage-link" onClick={() => router.navigate(COVERAGE_ROUTE)}>
        {COVERAGE.title}
      </button>
    </Section>
  );
}
