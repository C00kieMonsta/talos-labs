import { Component, useEffect, useRef } from "react";
import type { ErrorInfo, ReactNode } from "react";

export const SCREEN_ERROR_HEADING = "This screen could not be shown";
export const SCREEN_ERROR_BODY =
  "Something went wrong while drawing this screen. Your last report is kept; a fresh check-up usually clears it.";

interface Props {
  /** Changes when the route changes; a new screen gets a fresh start. */
  readonly resetKey: string;
  onRescan(): void;
  onSettings(): void;
  readonly children: ReactNode;
}

interface State {
  readonly failed: boolean;
}

/** Catches a render throw inside a screen and shows a way out instead of a blank window. */
export class ScreenErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("screen failed to render", error, info.componentStack);
  }

  override componentDidUpdate(previous: Props): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return <RecoveryCard onRescan={this.props.onRescan} onSettings={this.props.onSettings} />;
  }
}

function RecoveryCard({ onRescan, onSettings }: { onRescan(): void; onSettings(): void }) {
  const heading = useRef<HTMLHeadingElement>(null);

  // The screen the user was reading is gone; say so where they are.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <main className="screen">
      <section className="card" aria-labelledby="screen-error-heading">
        <h1 id="screen-error-heading" ref={heading} tabIndex={-1}>
          {SCREEN_ERROR_HEADING}
        </h1>
        <p>{SCREEN_ERROR_BODY}</p>
        <div className="actions">
          <button type="button" className="button button-primary" onClick={onRescan}>
            Rescan
          </button>
          <button type="button" className="link-button" onClick={onSettings}>
            Open Settings
          </button>
        </div>
      </section>
    </main>
  );
}
