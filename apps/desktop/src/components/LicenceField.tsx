import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { CircleCheck } from "lucide-react";
import type { LicenseInvalidReason, LicenseState } from "@talos/core";
import { useApp } from "../app/context";
import { LICENSE_INVALID_LABELS } from "../app/labels";

/** A pasted key that looks complete is verified on its own after a short pause. */
export const LICENCE_KEY_PATTERN = /^TL1\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{60,}$/;
export const LICENCE_AUTO_VERIFY_MS = 300;
export const LICENCE_UNLOCK_DELAY_MS = 800;

export const BUY_CAPTION = "Opens the Talos Labs shop in your browser. Your key arrives by email; paste it here.";

type FieldState =
  | { kind: "entry" }
  | { kind: "checking" }
  | { kind: "valid"; updatesUntil: string }
  | { kind: "invalid"; reason: LicenseInvalidReason };

export interface LicenceFieldProps {
  /** Called once the valid line has been shown, so the caller can swap the lock for its content. */
  onUnlocked?(state: LicenseState): void;
  onBuy(): void;
  /** Set when the field replaces a button, so typing can start at once. */
  autoFocus?: boolean;
}

export function LicenceField({ onUnlocked, onBuy, autoFocus = false }: LicenceFieldProps) {
  const { adapters, setLicense } = useApp();
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<FieldState>({ kind: "entry" });
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const unlockedRef = useRef(onUnlocked);
  unlockedRef.current = onUnlocked;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (debounce.current !== null) clearTimeout(debounce.current);
    };
  }, []);

  async function verify(key: string) {
    if (key.length === 0) return;
    setState({ kind: "checking" });
    let result: LicenseState;
    try {
      result = await adapters.license.install(key);
    } catch {
      result = { status: "invalid", reason: "format" };
    }
    if (!alive.current) return;
    if (result.status === "valid") {
      setState({ kind: "valid", updatesUntil: result.payload.updatesUntil });
      setDraft("");
      // The valid line stays on screen for a moment before the lock gives way to what it hid.
      setTimeout(() => {
        setLicense(result);
        if (alive.current) unlockedRef.current?.(result);
      }, LICENCE_UNLOCK_DELAY_MS);
    } else {
      setState({ kind: "invalid", reason: result.status === "invalid" ? result.reason : "format" });
    }
  }

  function change(value: string) {
    setDraft(value);
    if (state.kind === "invalid") setState({ kind: "entry" });
    if (debounce.current !== null) clearTimeout(debounce.current);
    const trimmed = value.trim();
    if (!LICENCE_KEY_PATTERN.test(trimmed)) return;
    debounce.current = setTimeout(() => {
      debounce.current = null;
      void verify(trimmed);
    }, LICENCE_AUTO_VERIFY_MS);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (debounce.current !== null) {
      clearTimeout(debounce.current);
      debounce.current = null;
    }
    void verify(draft.trim());
  }

  if (state.kind === "valid") {
    return (
      <p className="licence-valid" tabIndex={-1}>
        <CircleCheck size={16} aria-hidden="true" /> Licensed. Updates until {state.updatesUntil}
      </p>
    );
  }

  const checking = state.kind === "checking";
  const invalid = state.kind === "invalid";
  return (
    <form className="licence-field" onSubmit={submit}>
      <label htmlFor={inputId} className="visually-hidden">
        Licence key
      </label>
      <div className="field-row">
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          value={draft}
          placeholder="Paste your licence key"
          disabled={checking}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => change(event.target.value)}
        />
        <button type="submit" className="button" disabled={checking || draft.trim().length === 0}>
          {checking ? "Checking" : "Activate"}
        </button>
      </div>
      {invalid && (
        <p className="notice" id={errorId} role="alert">
          {LICENSE_INVALID_LABELS[state.reason]}
        </p>
      )}
      <p className="muted small">
        <button type="button" className="link-button" onClick={onBuy}>
          Buy a licence
        </button>{" "}
        {BUY_CAPTION}
      </p>
    </form>
  );
}
