import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../app/context";
import { Brand } from "../components/Brand";
import { Hero } from "../components/Hero";
import { Icon } from "../components/Icon";
import type { ToolbarAction } from "../components/Toolbar";

/** Which hero bands the screen in the shell wants: the spiral top-right, the horizon at the foot. */
export interface GuidedHero {
  readonly spiral: boolean;
  readonly horizon: boolean;
  /** The spiral breathes while the screen's own request runs. */
  readonly writing: boolean;
}

const HeroContext = createContext<(hero: GuidedHero | null) => void>(() => undefined);

/** Text links drawn in the strip before "Details" and "Settings" (the chat's "Step by step", the walk-through's "Chat"). */
export interface GuidedStrip {
  readonly links: readonly { readonly label: string; onClick(): void }[];
}

const StripContext = createContext<(strip: GuidedStrip | null) => void>(() => undefined);

/** A screen rendered inside the shell asks for its strip links; they go when the screen does. */
export function useGuidedStrip(strip: GuidedStrip | null): void {
  const set = useContext(StripContext);
  useEffect(() => {
    set(strip);
    return () => set(null);
  }, [set, strip]);
}

/** A screen asks the shell for its hero bands; they go when the screen does. */
export function useGuidedHero(spiral: boolean, horizon: boolean, writing = false): void {
  const set = useContext(HeroContext);
  useEffect(() => {
    set({ spiral, horizon, writing });
    return () => set(null);
  }, [set, spiral, horizon, writing]);
}

/** The guided shell: no sidebar, a 52 px strip with the brand, "Details" and "Settings", one centred column that is the main landmark. */
export function GuidedShell({ title, actions = [], inactive, hero, strip, children }: { title?: string; actions?: readonly ToolbarAction[]; inactive: boolean; hero?: ReactNode; strip?: GuidedStrip; children: ReactNode }) {
  const { router } = useApp();
  const [wanted, setWanted] = useState<GuidedHero | null>(null);
  const [asked, setAsked] = useState<GuidedStrip | null>(null);
  const links = strip?.links ?? asked?.links ?? [];
  return (
    <div className={inactive ? "shell guided-shell window-inactive" : "shell guided-shell"}>
      <header className="title-strip guided-strip" data-tauri-drag-region="true">
        <Brand size={24} className="guided-brand" />
        {title !== undefined && <h1 className="guided-strip-title">{title}</h1>}
        <div className="guided-strip-actions">
          {actions.map((action) => (
            <button key={action.label} type="button" className="button icon-button" title={action.label} onClick={action.onClick} disabled={action.disabled} aria-disabled={action.disabled}>
              <Icon icon={action.icon} />
              <span className="visually-hidden">{action.label}</span>
            </button>
          ))}
          {actions.length === 0 && (
            <>
              {links.map((link) => (
                <button key={link.label} type="button" className="guided-strip-link" onClick={link.onClick}>
                  {link.label}
                </button>
              ))}
              <button type="button" className="guided-strip-link" onClick={() => router.navigate({ name: "overview" })}>
                Details
              </button>
              <button type="button" className="guided-strip-link" onClick={() => router.navigate({ name: "settings" })}>
                Settings
              </button>
            </>
          )}
        </div>
      </header>
      <div className="content guided-content">
        {hero}
        {wanted?.spiral === true && <Hero kind="spiral" writing={wanted.writing} />}
        <HeroContext.Provider value={setWanted}>
          <StripContext.Provider value={setAsked}>
            <main className="guided">{children}</main>
          </StripContext.Provider>
        </HeroContext.Provider>
        {wanted?.horizon === true && <Hero kind="horizon" />}
      </div>
    </div>
  );
}
