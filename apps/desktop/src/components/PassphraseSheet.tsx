import { useId, useState } from "react";
import type { FormEvent } from "react";
import { ICONS } from "../app/icons";
import { Icon } from "./Icon";

export const PASSPHRASE_HINT = "Twelve characters or more. A few unrelated words works well. There is no way to recover it.";
export const PASSPHRASE_MIN = 8;
export const PASSPHRASE_MAX = 256;

/** The same rule Rust applies: 8 to 256 code points and no control characters. */
export function passphraseProblem(value: string, repeat: string): string | null {
  const length = [...value].length;
  if (length < PASSPHRASE_MIN) return `Use at least ${PASSPHRASE_MIN} characters.`;
  if (length > PASSPHRASE_MAX) return `Use at most ${PASSPHRASE_MAX} characters.`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return "The passphrase can't contain control characters.";
  if (value !== repeat) return "The two passphrases don't match.";
  return null;
}

/** Body of the confirm sheet for 029: the key path, two fields, a hint and Add passphrase. */
export function PassphraseForm({ keyPath, onSubmit, submitLabel = "Add passphrase" }: { keyPath: string | null; onSubmit(passphrase: string): void; submitLabel?: string }) {
  const id = useId();
  const [value, setValue] = useState("");
  const [repeat, setRepeat] = useState("");
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const problem = passphraseProblem(value, repeat);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (problem === null) onSubmit(value);
  };
  return (
    <form className="passphrase-form" onSubmit={submit} noValidate>
      {keyPath !== null && (
        <p className="muted small">
          Key: <code className="mono">{keyPath}</code>
        </p>
      )}
      <div className="field-row">
        <label htmlFor={`${id}-new`}>New passphrase</label>
        <input
          id={`${id}-new`}
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-describedby={`${id}-hint`}
          autoFocus
        />
      </div>
      <div className="field-row">
        <label htmlFor={`${id}-repeat`}>Repeat it</label>
        <input
          id={`${id}-repeat`}
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          onBlur={() => setTouched(true)}
        />
      </div>
      <button type="button" className="button button-ghost button-small" onClick={() => setShow((s) => !s)} aria-pressed={show}>
        <Icon icon={show ? ICONS.eyeOff : ICONS.eye} /> {show ? "Hide" : "Show"}
      </button>
      <p id={`${id}-hint`} className="muted small">
        {PASSPHRASE_HINT}
      </p>
      {touched && problem !== null && (
        <p className="notice" role="alert">
          {problem}
        </p>
      )}
      <div className="sheet-actions">
        <button type="submit" className="button button-primary" aria-disabled={problem !== null}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
